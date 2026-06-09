use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    Json,
};
use regex::Regex;
use std::sync::LazyLock;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::Db;
use crate::handlers::link_preview;
use crate::models::*;

/// Pattern matching http(s) URLs. Shared so tag extraction can mask URLs out
/// of the content before scanning for `#tag`s — otherwise a URL fragment like
/// `…/10755#ticket-info` would be mistaken for a `#ticket` tag.
const URL_PATTERN: &str = r#"https?://[^\s<>()\[\]{}"']+"#;

// Regexes are compiled once: every post create/edit (and every imported post in
// the backfill pass) scans content for URLs and tags.
static URL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(URL_PATTERN).unwrap());
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"#([\w]+)").unwrap());

fn extract_tags(content: &str) -> Vec<String> {
    // Drop URLs first so their `#fragment`s aren't picked up as tags.
    let without_urls = URL_RE.replace_all(content, " ");
    TAG_RE
        .captures_iter(&without_urls)
        .map(|c| c[1].to_lowercase())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect()
}

/// Extract http(s) URLs from post content, de-duplicated, trailing
/// punctuation stripped.
fn extract_urls(content: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut urls = Vec::new();
    for m in URL_RE.find_iter(content) {
        let url = m
            .as_str()
            .trim_end_matches(['.', ',', '!', '?', ';', ':', '\'', '"'])
            .to_string();
        if seen.insert(url.clone()) {
            urls.push(url);
        }
    }
    urls
}

fn now_ts() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub(crate) fn query_ids<P: rusqlite::Params>(
    conn: &rusqlite::Connection,
    sql: &str,
    params: P,
) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map(params, |r| r.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

fn check_post_owner(
    conn: &rusqlite::Connection,
    post_id: &str,
    user_id: &str,
) -> Result<String, ApiError> {
    let (owner, content): (String, String) = conn
        .query_row(
            "SELECT user_id, content FROM posts WHERE id = ?1",
            [post_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "Post not found"))?;
    if owner != user_id {
        return Err(err(StatusCode::FORBIDDEN, "Not your post"));
    }
    Ok(content)
}

/// Post ids whose link previews are being resolved right now. The same post can
/// be handed to two unrelated tasks — its own create/edit, and the periodic
/// import backfill — and both act during the window when it still has no
/// `post_links` rows, so letting them overlap inserts every preview twice (two
/// cards). Dynamic Twitch links can't be deduped by URL, so this claim is the
/// only thing that keeps them single. Whoever claims a post resolves it; the
/// rest back off. One process owns the shared DB, so this set is authoritative.
static RESOLVING: LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    LazyLock::new(|| std::sync::Mutex::new(std::collections::HashSet::new()));

/// Frees a post's `RESOLVING` claim on drop, so the slot reopens even if
/// resolution returns early or panics.
struct ResolveClaim(String);
impl Drop for ResolveClaim {
    fn drop(&mut self) {
        RESOLVING.lock().unwrap().remove(&self.0);
    }
}

/// Resolve link previews for every URL in `content` and (re)attach them to the
/// post. Runs after the post row exists; performs network I/O without holding
/// the DB lock.
pub(crate) async fn attach_link_previews(db: &Db, post_id: &str, content: &str) {
    // Claim this post; if another task is already resolving it, leave it to them
    // rather than racing and double-inserting. The guard frees the claim on exit.
    let _claim = {
        let mut resolving = RESOLVING.lock().unwrap();
        if !resolving.insert(post_id.to_string()) {
            return;
        }
        ResolveClaim(post_id.to_string())
    };

    {
        let conn = db.lock().unwrap();
        conn.execute("DELETE FROM post_links WHERE post_id = ?1", [post_id])
            .ok();
    }
    for url in extract_urls(content).into_iter().take(4) {
        if let Some((preview_id, _)) = link_preview::resolve_and_cache(db, &url).await {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT OR IGNORE INTO post_links (post_id, link_preview_id) VALUES (?1, ?2)",
                rusqlite::params![post_id, preview_id],
            )
            .ok();
        }
    }
}

/// Auto-resolve previews for *imported* posts: ones whose content contains URLs
/// but that have no `post_links` rows yet (e.g. after importing a database dump
/// of posts). Runs as a background pass; each URL is resolved through the shared
/// rate limiter so a large import drains gradually without hammering providers.
/// Returns the number of posts processed this pass. Capped per pass so the
/// scan stays cheap; subsequent passes pick up the remainder.
pub async fn backfill_imported_previews(db: &Db) -> usize {
    let pending: Vec<(String, String)> = {
        let conn = db.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT p.id, p.content FROM posts p
             WHERE p.content LIKE '%http%'
               AND NOT EXISTS (SELECT 1 FROM post_links pl WHERE pl.post_id = p.id)
             LIMIT 200",
        ) {
            Ok(s) => s,
            Err(_) => return 0,
        };
        let rows = match stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }) {
            Ok(it) => it.filter_map(|x| x.ok()).collect(),
            Err(_) => return 0,
        };
        rows
    };

    let mut processed = 0;
    for (id, content) in pending {
        if extract_urls(&content).is_empty() {
            continue;
        }
        attach_link_previews(db, &id, &content).await;
        processed += 1;
    }
    processed
}

fn fetch_link_previews(db: &rusqlite::Connection, post_id: &str) -> Vec<LinkPreviewInfo> {
    let mut stmt = db
        .prepare(
            "SELECT lp.url, lp.title, lp.description, lp.image_url, lp.thumbnail, lp.site_name, lp.author
             FROM link_previews lp
             JOIN post_links pl ON lp.id = pl.link_preview_id
             WHERE pl.post_id = ?1",
        )
        .unwrap();
    stmt.query_map([post_id], |r| link_preview::preview_from_row(r, 0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

fn find_root(db: &rusqlite::Connection, start: &str) -> String {
    let mut current = start.to_string();
    loop {
        let parent: Option<String> = db
            .query_row(
                "SELECT parent_post_id FROM posts WHERE id = ?1",
                [&current],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        match parent {
            Some(p) => current = p,
            None => return current,
        }
    }
}

pub fn build_post(db: &rusqlite::Connection, post_id: &str) -> Option<PostResponse> {
    let row = db
        .query_row(
            "SELECT p.id, p.user_id, u.username, p.parent_post_id, p.content, p.created_at, p.updated_at
             FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?1",
            [post_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                ))
            },
        )
        .ok()?;

    let (id, user_id, username, parent_post_id, content, created_at, updated_at) = row;

    let root_post_id = match parent_post_id {
        None => id.clone(),
        Some(_) => find_root(db, &id),
    };

    // Images
    let mut stmt = db
        .prepare("SELECT id, filename, width, height FROM post_images WHERE post_id = ?1 ORDER BY position")
        .unwrap();
    let images: Vec<ImageInfo> = stmt
        .query_map([&id], |r| {
            Ok(ImageInfo {
                id: r.get(0)?,
                url: format!("/uploads/images/{}", r.get::<_, String>(1)?),
                width: r.get(2)?,
                height: r.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Tags
    let mut stmt = db
        .prepare("SELECT tag FROM post_tags WHERE post_id = ?1")
        .unwrap();
    let tags: Vec<String> = stmt
        .query_map([&id], |r| r.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Link previews
    let link_previews = fetch_link_previews(db, &id);

    // Followup count
    let followup_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM posts WHERE parent_post_id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // Parent post summary
    let parent_post = if let Some(ref pid) = parent_post_id {
        db.query_row(
            "SELECT p.id, u.username, p.content, p.created_at
             FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?1",
            [pid],
            |r| {
                Ok(ParentPostSummary {
                    id: r.get(0)?,
                    username: r.get(1)?,
                    content: r.get(2)?,
                    created_at: r.get(3)?,
                    link_previews: Vec::new(),
                })
            },
        )
        .ok()
        .map(|mut p: ParentPostSummary| {
            p.link_previews = fetch_link_previews(db, &p.id);
            p
        })
    } else {
        None
    };

    Some(PostResponse {
        id,
        user_id,
        username,
        parent_post_id,
        root_post_id,
        parent_post,
        content,
        images,
        link_previews,
        tags,
        followup_count,
        created_at,
        updated_at,
    })
}

/// Hydrate a page of post ids into full posts (skipping any that vanished) and
/// assemble the list response. Shared by the timeline and search.
pub fn posts_page(
    conn: &rusqlite::Connection,
    ids: &[String],
    total: i64,
    page: u32,
    limit: u32,
) -> PostsListResponse {
    let posts = ids.iter().filter_map(|id| build_post(conn, id)).collect();
    let pages = ((total as f64) / (limit as f64)).ceil() as u32;
    PostsListResponse {
        posts,
        total,
        page,
        pages,
    }
}

pub async fn list_posts(
    State(db): State<Db>,
    Query(query): Query<PostsQuery>,
) -> Result<Json<PostsListResponse>, ApiError> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(100);
    let offset = (page - 1) * limit;

    let conn = db.lock().unwrap();

    // An empty `params` slice (no tag filter) is handled by `params_from_iter`
    // just like a non-empty one, so both queries take the same path.
    let (count_sql, list_sql, params): (String, String, Vec<Box<dyn rusqlite::types::ToSql>>) =
        if let Some(ref tag) = query.tag {
            (
                "SELECT COUNT(DISTINCT p.id) FROM posts p JOIN post_tags pt ON p.id = pt.post_id WHERE pt.tag = ?1".into(),
                format!(
                    "SELECT DISTINCT p.id FROM posts p JOIN post_tags pt ON p.id = pt.post_id WHERE pt.tag = ?1 ORDER BY p.created_at DESC LIMIT {} OFFSET {}",
                    limit, offset
                ),
                vec![Box::new(tag.to_lowercase())],
            )
        } else {
            (
                "SELECT COUNT(*) FROM posts".into(),
                format!(
                    "SELECT id FROM posts ORDER BY created_at DESC LIMIT {} OFFSET {}",
                    limit, offset
                ),
                vec![],
            )
        };

    let total: i64 = conn
        .query_row(&count_sql, rusqlite::params_from_iter(&params), |r| r.get(0))
        .unwrap_or(0);

    let post_ids = query_ids(&conn, &list_sql, rusqlite::params_from_iter(&params));

    Ok(Json(posts_page(&conn, &post_ids, total, page, limit)))
}

pub async fn create_post(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let post_id = Uuid::new_v4().to_string();
    let mut content = String::new();
    let mut parent_post_id: Option<String> = None;
    let mut images: Vec<(String, Vec<u8>)> = Vec::new(); // (original_name, data)

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "content" => {
                content = field.text().await.unwrap_or_default();
            }
            "parent_post_id" => {
                let val = field.text().await.unwrap_or_default();
                if !val.is_empty() {
                    parent_post_id = Some(val);
                }
            }
            "images" => {
                let original_name = field
                    .file_name()
                    .unwrap_or("image.png")
                    .to_string();
                let data = field.bytes().await.unwrap_or_default().to_vec();
                if !data.is_empty() {
                    images.push((original_name, data));
                }
            }
            _ => {}
        }
    }

    if content.trim().is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Content is required"));
    }

    // Save each image in its original format (fast); AVIF conversion happens in
    // the background afterwards.
    let mut saved: Vec<(String, String, bool, Option<i64>, Option<i64>)> = Vec::new(); // (filename, original_name, convert, width, height)
    for (original_name, data) in images {
        let (width, height) = imagesize::blob_size(&data)
            .map(|s| (s.width as i64, s.height as i64))
            .ok()
            .unzip();
        let (filename, convert) = link_preview::save_original("images", &original_name, &data)
            .await
            .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image"))?;
        saved.push((filename, original_name, convert, width, height));
    }

    let tags = extract_tags(&content);
    let now = now_ts();

    // Images needing background AVIF conversion: (image_id, filename).
    let mut to_convert: Vec<(String, String)> = Vec::new();
    {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO posts (id, user_id, parent_post_id, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![post_id, user_id, parent_post_id, content.trim(), now, now],
        )
        .map_err(|e| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create post: {}", e),
            )
        })?;

        // Save images to db
        for (i, (filename, original_name, convert, width, height)) in saved.iter().enumerate() {
            let img_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO post_images (id, post_id, filename, original_name, position, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![img_id, post_id, filename, original_name, i as i32, width, height],
            )
            .ok();
            if *convert {
                to_convert.push((img_id, filename.clone()));
            }
        }

        // Save tags
        for tag in &tags {
            conn.execute(
                "INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?1, ?2)",
                rusqlite::params![post_id, tag],
            )
            .ok();
        }
    }

    for (img_id, filename) in to_convert {
        link_preview::spawn_avif_switch(
            db.clone(),
            "images",
            filename,
            link_preview::AvifSwitch::PostImage(img_id),
        );
    }

    // Resolve + attach link previews (network I/O — no DB lock held).
    attach_link_previews(&db, &post_id, &content).await;

    let conn = db.lock().unwrap();
    let post = build_post(&conn, &post_id).unwrap();
    Ok(Json(serde_json::json!({ "post": post })))
}

fn collect_descendants(conn: &rusqlite::Connection, parent_id: &str, out: &mut Vec<PostResponse>) {
    let child_ids = query_ids(
        conn,
        "SELECT id FROM posts WHERE parent_post_id = ?1 ORDER BY created_at ASC",
        [parent_id],
    );
    for cid in child_ids {
        if let Some(p) = build_post(conn, &cid) {
            out.push(p);
            collect_descendants(conn, &cid, out);
        }
    }
}

pub async fn get_post(
    State(db): State<Db>,
    Path(id): Path<String>,
) -> Result<Json<PostDetailResponse>, ApiError> {
    let conn = db.lock().unwrap();
    let post = build_post(&conn, &id)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Post not found"))?;

    // Get the full echo thread: all descendants, depth-first so each echo is
    // immediately followed by its own chained echoes. The client rebuilds the
    // tree from each post's parent_post_id.
    let mut followups: Vec<PostResponse> = Vec::new();
    collect_descendants(&conn, &id, &mut followups);

    Ok(Json(PostDetailResponse { post, followups }))
}

pub async fn update_post(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePostRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Whether the set of URLs in the post changed. Only then do we re-resolve
    // link previews (which re-downloads images and regenerates thumbnails).
    // Editing tags — or any other text while the links stay the same — leaves
    // the existing previews, and their thumbnails, untouched.
    let links_changed = {
        let conn = db.lock().unwrap();

        // Ownership check also yields the pre-edit content for the link diff.
        let old_content = check_post_owner(&conn, &id, &user_id)?;

        let now = now_ts();
        conn.execute(
            "UPDATE posts SET content = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![body.content.trim(), now, id],
        )
        .unwrap();

        // Re-extract tags
        conn.execute("DELETE FROM post_tags WHERE post_id = ?1", [&id])
            .ok();
        for tag in extract_tags(&body.content) {
            conn.execute(
                "INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?1, ?2)",
                rusqlite::params![id, tag],
            )
            .ok();
        }

        let old_urls: std::collections::HashSet<String> =
            extract_urls(&old_content).into_iter().collect();
        let new_urls: std::collections::HashSet<String> =
            extract_urls(&body.content).into_iter().collect();
        old_urls != new_urls
    };

    // Re-resolve + attach link previews only when the links actually changed.
    if links_changed {
        attach_link_previews(&db, &id, &body.content).await;
    }

    let conn = db.lock().unwrap();
    let post = build_post(&conn, &id).unwrap();
    Ok(Json(serde_json::json!({ "post": post })))
}

pub async fn delete_post(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Path(id): Path<String>,
) -> Result<Json<MessageResponse>, ApiError> {
    let conn = db.lock().unwrap();

    check_post_owner(&conn, &id, &user_id)?;

    // Collect this post's image files and linked previews before the cascade.
    let images = query_ids(&conn, "SELECT filename FROM post_images WHERE post_id = ?1", [&id]);
    let preview_ids = query_ids(
        &conn,
        "SELECT link_preview_id FROM post_links WHERE post_id = ?1",
        [&id],
    );

    // Deleting the post cascades its post_links/post_images/post_tags.
    conn.execute("DELETE FROM posts WHERE id = ?1", [&id])
        .unwrap();

    for f in images {
        let _ = std::fs::remove_file(format!("uploads/images/{}", f));
    }

    // Drop previews no other post still references (file + row).
    for pid in preview_ids {
        let still: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM post_links WHERE link_preview_id = ?1",
                [&pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if still > 0 {
            continue;
        }
        let thumb: Option<String> = conn
            .query_row("SELECT thumbnail FROM link_previews WHERE id = ?1", [&pid], |r| r.get(0))
            .ok()
            .flatten();
        if let Some(name) = thumb.as_deref().and_then(|t| t.rsplit('/').next()) {
            let _ = std::fs::remove_file(format!("uploads/previews/{}", name));
        }
        conn.execute("DELETE FROM link_previews WHERE id = ?1", [&pid])
            .ok();
    }

    Ok(Json(MessageResponse {
        message: "Post deleted".into(),
    }))
}
