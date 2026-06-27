use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    Json,
};
use regex::Regex;
use std::sync::LazyLock;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::{query_rows, Db, DbExt};
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
    query_rows(conn, sql, params, |r| r.get(0))
}

pub(crate) fn thread_cte(matched_sql: &str) -> String {
    format!(
        "WITH RECURSIVE
         matched(id) AS ({matched_sql}),
         ancestors(id, parent_post_id) AS (
           SELECT p.id, p.parent_post_id FROM posts p WHERE p.id IN (SELECT id FROM matched)
           UNION
           SELECT p.id, p.parent_post_id FROM posts p JOIN ancestors a ON p.id = a.parent_post_id
         ),
         roots(id) AS (SELECT id FROM ancestors WHERE parent_post_id IS NULL),
         thread(id, root) AS (
           SELECT id, id FROM roots
           UNION
           SELECT p.id, t.root FROM posts p JOIN thread t ON p.parent_post_id = t.id
         )"
    )
}

pub(crate) fn thread_ordered_select(cte: &str, limit: u32, offset: u32) -> String {
    format!(
        "{cte}
         SELECT p.id FROM thread th
         JOIN posts p ON p.id = th.id
         JOIN (SELECT t2.root AS root, MAX(p2.created_at) AS last_at
               FROM thread t2 JOIN posts p2 ON p2.id = t2.id GROUP BY t2.root) tr
           ON tr.root = th.root
         ORDER BY tr.last_at DESC, th.root, p.created_at DESC
         LIMIT {limit} OFFSET {offset}"
    )
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
        RESOLVING.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
    }
}

/// Resolve link previews for every URL in `content` and (re)attach them to the
/// post. Runs after the post row exists; performs network I/O without holding
/// the DB lock.
pub(crate) async fn attach_link_previews(db: &Db, post_id: &str, content: &str) {
    // Claim this post; if another task is already resolving it, leave it to them
    // rather than racing and double-inserting. The guard frees the claim on exit.
    let _claim = {
        let mut resolving = RESOLVING.lock().unwrap_or_else(|e| e.into_inner());
        if !resolving.insert(post_id.to_string()) {
            return;
        }
        ResolveClaim(post_id.to_string())
    };

    {
        let conn = db.conn();
        conn.execute("DELETE FROM post_links WHERE post_id = ?1", [post_id])
            .ok();
    }
    for url in extract_urls(content).into_iter().take(4) {
        if let Some((preview_id, _)) = link_preview::resolve_and_cache(db, &url).await {
            let conn = db.conn();
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
        let conn = db.conn();
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

fn fetch_images(db: &rusqlite::Connection, post_id: &str) -> Vec<ImageInfo> {
    query_rows(
        db,
        "SELECT id, filename, width, height FROM post_images WHERE post_id = ?1 ORDER BY position",
        [post_id],
        |r| {
            Ok(ImageInfo {
                id: r.get(0)?,
                url: format!("/uploads/images/{}", r.get::<_, String>(1)?),
                width: r.get(2)?,
                height: r.get(3)?,
            })
        },
    )
}

fn fetch_link_previews(db: &rusqlite::Connection, post_id: &str) -> Vec<LinkPreviewInfo> {
    let rows: Vec<(String, LinkPreviewInfo)> = query_rows(
        db,
        &format!(
            "SELECT lp.id, {}
             FROM link_previews lp
             JOIN post_links pl ON lp.id = pl.link_preview_id
             WHERE pl.post_id = ?1",
            link_preview::PREVIEW_COLS
        ),
        [post_id],
        |r| Ok((r.get::<_, String>(0)?, link_preview::preview_from_row(r, 1)?)),
    );
    rows.into_iter()
        .map(|(id, mut info)| {
            link_preview::attach_images(db, &id, &mut info);
            info
        })
        .collect()
}

/// The post a post echoes (its parent), or `None` for a root post or a missing id.
fn parent_of(db: &rusqlite::Connection, id: &str) -> Option<String> {
    db.query_row(
        "SELECT parent_post_id FROM posts WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .ok()
    .flatten()
}

/// Whether `target` is `candidate` itself or one of its ancestors. Re-parenting
/// post X under parent P is a cycle when X equals P or X is an ancestor of P
/// (P lives in X's own thread), which would make the parent chain loop and hang
/// [`find_root`]. Walks up from `candidate` looking for `target`.
fn is_self_or_ancestor(db: &rusqlite::Connection, target: &str, candidate: &str) -> bool {
    let mut current = candidate.to_string();
    loop {
        if current == target {
            return true;
        }
        match parent_of(db, &current) {
            Some(p) => current = p,
            None => return false,
        }
    }
}

fn find_root(db: &rusqlite::Connection, start: &str) -> String {
    let mut current = start.to_string();
    while let Some(parent) = parent_of(db, &current) {
        current = parent;
    }
    current
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
    let images = fetch_images(db, &id);

    // Tags
    let tags: Vec<String> = query_ids(db, "SELECT tag FROM post_tags WHERE post_id = ?1", [&id]);

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
                    images: Vec::new(),
                    link_previews: Vec::new(),
                })
            },
        )
        .ok()
        .map(|mut p: ParentPostSummary| {
            p.images = fetch_images(db, &p.id);
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
        matches: None,
    }
}

pub async fn list_posts(
    State(db): State<Db>,
    Query(query): Query<PostsQuery>,
) -> Result<Json<PostsListResponse>, ApiError> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(100);
    let offset = (page - 1) * limit;

    let conn = db.conn();

    // An empty `params` slice (no tag filter) is handled by `params_from_iter`
    // just like a non-empty one, so both queries take the same path.
    let (count_sql, list_sql, params): (String, String, Vec<Box<dyn rusqlite::types::ToSql>>) =
        if let Some(ref tag) = query.tag {
            let cte = thread_cte(
                "SELECT p.id FROM posts p JOIN post_tags pt ON p.id = pt.post_id WHERE pt.tag = ?1",
            );
            (
                format!("{cte} SELECT COUNT(*) FROM thread"),
                thread_ordered_select(&cte, limit, offset),
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

struct SavedImage {
    filename: String,
    original_name: String,
    convert: bool,
    width: Option<i64>,
    height: Option<i64>,
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

    if content.trim().is_empty() && images.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Content or an image is required"));
    }

    // Save each image in its original format (fast); AVIF conversion happens in
    // the background afterwards.
    let mut saved: Vec<SavedImage> = Vec::new();
    for (original_name, data) in images {
        let (width, height) = imagesize::blob_size(&data)
            .map(|s| (s.width as i64, s.height as i64))
            .ok()
            .unzip();
        let (filename, convert) = link_preview::save_original("images", &original_name, &data)
            .await
            .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image"))?;
        saved.push(SavedImage {
            filename,
            original_name,
            convert,
            width,
            height,
        });
    }

    let tags = extract_tags(&content);
    let now = now_ts();

    // Images needing background AVIF conversion: (image_id, filename).
    let mut to_convert: Vec<(String, String)> = Vec::new();
    {
        let conn = db.conn();
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
        for (i, img) in saved.iter().enumerate() {
            let img_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO post_images (id, post_id, filename, original_name, position, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![img_id, post_id, img.filename, img.original_name, i as i32, img.width, img.height],
            )
            .ok();
            if img.convert {
                to_convert.push((img_id, img.filename.clone()));
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

    let conn = db.conn();
    let post = build_post(&conn, &post_id)
        .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load created post"))?;
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
    let conn = db.conn();
    let post = build_post(&conn, &id)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Post not found"))?;

    // Get the full echo thread: all descendants, depth-first so each echo is
    // immediately followed by its own chained echoes. The client rebuilds the
    // tree from each post's parent_post_id.
    let mut followups: Vec<PostResponse> = Vec::new();
    collect_descendants(&conn, &id, &mut followups);

    Ok(Json(PostDetailResponse { post, followups }))
}

/// A position in the post's edited image list: a kept existing image (by id) or
/// one of the newly uploaded files (by its index in `uploads`).
enum ImageSlot {
    Existing(String),
    New(usize),
}

/// Parse a `new:<n>` image-order token into its upload index.
fn parse_new_token(token: &str) -> Option<usize> {
    token.strip_prefix("new:").and_then(|n| n.parse().ok())
}

pub async fn update_post(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut content = String::new();
    // Echo (parent) link change, three states preserved across multipart (which
    // has no JSON null): the field absent leaves it `None` (unchanged); present
    // and empty is `Some(None)` (unlink); present with a value is `Some(Some)`.
    let mut parent_change: Option<Option<String>> = None;
    // Desired final image order, as tokens (an existing image id, or `new:<n>`
    // for the nth uploaded file). Absent means "leave images untouched".
    let mut image_order: Option<Vec<String>> = None;
    // Newly uploaded files in arrival order: (original_name, data).
    let mut uploads: Vec<(String, Vec<u8>)> = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "content" => {
                content = field.text().await.unwrap_or_default();
            }
            "parent_post_id" => {
                let val = field.text().await.unwrap_or_default();
                parent_change = Some(if val.is_empty() { None } else { Some(val) });
            }
            "image_order" => {
                let val = field.text().await.unwrap_or_default();
                image_order = serde_json::from_str::<Vec<String>>(&val).ok();
            }
            "images" => {
                let original_name = field.file_name().unwrap_or("image.png").to_string();
                let data = field.bytes().await.unwrap_or_default().to_vec();
                if !data.is_empty() {
                    uploads.push((original_name, data));
                }
            }
            _ => {}
        }
    }

    // Plan the edited image list before any destructive work, so a rejected edit
    // leaves the post (and its files) untouched. `slots` is the final order;
    // `kept` is the set of existing image ids that survive (everything else the
    // post currently holds is removed); `used_new` tracks which uploads are
    // actually referenced (the rest are discarded, never written).
    let (slots, kept, used_new): (Vec<ImageSlot>, std::collections::HashSet<String>, Vec<usize>) =
        if let Some(ref order) = image_order {
            let existing: std::collections::HashSet<String> = {
                let conn = db.conn();
                query_ids(&conn, "SELECT id FROM post_images WHERE post_id = ?1", [&id])
                    .into_iter()
                    .collect()
            };
            let mut slots = Vec::new();
            let mut kept = std::collections::HashSet::new();
            let mut used_new = Vec::new();
            for token in order {
                if let Some(n) = parse_new_token(token) {
                    if n < uploads.len() && !used_new.contains(&n) {
                        used_new.push(n);
                        slots.push(ImageSlot::New(n));
                    }
                } else if existing.contains(token) && kept.insert(token.clone()) {
                    slots.push(ImageSlot::Existing(token.clone()));
                }
            }
            (slots, kept, used_new)
        } else {
            // No image_order field: keep whatever the post already has.
            (Vec::new(), std::collections::HashSet::new(), Vec::new())
        };

    // A post must still carry text or at least one image after the edit.
    if image_order.is_some() && content.trim().is_empty() && slots.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Content or an image is required"));
    }

    // Persist only the uploads that are actually referenced by the order, keyed
    // by their upload index. Done before the DB write but after planning, so a
    // failure here can't leave the row half-updated.
    let mut new_saved: std::collections::HashMap<usize, SavedImage> = std::collections::HashMap::new();
    for &n in &used_new {
        let (original_name, data) = &uploads[n];
        let (width, height) = imagesize::blob_size(data)
            .map(|s| (s.width as i64, s.height as i64))
            .ok()
            .unzip();
        let (filename, convert) = link_preview::save_original("images", original_name, data)
            .await
            .ok_or_else(|| {
                // Roll back any files already written this request before bailing.
                for s in new_saved.values() {
                    let _ = std::fs::remove_file(format!("uploads/images/{}", s.filename));
                }
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save image")
            })?;
        new_saved.insert(
            n,
            SavedImage {
                filename,
                original_name: original_name.clone(),
                convert,
                width,
                height,
            },
        );
    }

    // Whether the set of URLs in the post changed. Only then do we re-resolve
    // link previews (which re-downloads images and regenerates thumbnails).
    // Editing tags — or any other text while the links stay the same — leaves
    // the existing previews, and their thumbnails, untouched.
    let mut removed_files: Vec<String> = Vec::new();
    let mut to_convert: Vec<(String, String)> = Vec::new();
    let links_changed = {
        let conn = db.conn();

        // Ownership check also yields the pre-edit content for the link diff.
        let old_content = check_post_owner(&conn, &id, &user_id)?;

        // Validate any echo (parent) link change before touching the row, so a
        // rejected re-parent leaves the post completely unmodified.
        if let Some(Some(new_parent)) = parent_change.as_ref() {
            if new_parent == &id {
                return Err(err(StatusCode::BAD_REQUEST, "A post can't echo itself"));
            }
            let parent_exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM posts WHERE id = ?1",
                    [new_parent],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if parent_exists == 0 {
                return Err(err(StatusCode::NOT_FOUND, "Post to echo not found"));
            }
            if is_self_or_ancestor(&conn, &id, new_parent) {
                return Err(err(
                    StatusCode::BAD_REQUEST,
                    "Can't echo a post from this post's own thread",
                ));
            }
        }

        let now = now_ts();
        // Fold any echo (parent) link change into the same row write: `Some`
        // carries the new value (a string to link, NULL to unlink), `None`
        // leaves parent_post_id untouched.
        match &parent_change {
            Some(new_parent) => conn.execute(
                "UPDATE posts SET content = ?1, updated_at = ?2, parent_post_id = ?3 WHERE id = ?4",
                rusqlite::params![content.trim(), now, new_parent, id],
            ),
            None => conn.execute(
                "UPDATE posts SET content = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![content.trim(), now, id],
            ),
        }
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update post"))?;

        // Apply the image edit only when an order was supplied.
        if image_order.is_some() {
            // Drop images the edit removed: collect their files for deletion
            // (after the row goes away, so nothing dangles), then delete rows.
            let removed: Vec<(String, String)> = query_rows(
                &conn,
                "SELECT id, filename FROM post_images WHERE post_id = ?1",
                [&id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .into_iter()
            .filter(|(img_id, _)| !kept.contains(img_id))
            .collect();
            for (img_id, filename) in &removed {
                conn.execute("DELETE FROM post_images WHERE id = ?1", [img_id])
                    .ok();
                removed_files.push(filename.clone());
            }

            // Write the final order: reposition kept images, insert new ones.
            for (position, slot) in slots.iter().enumerate() {
                match slot {
                    ImageSlot::Existing(img_id) => {
                        conn.execute(
                            "UPDATE post_images SET position = ?1 WHERE id = ?2",
                            rusqlite::params![position as i32, img_id],
                        )
                        .ok();
                    }
                    ImageSlot::New(n) => {
                        let img = &new_saved[n];
                        let img_id = Uuid::new_v4().to_string();
                        conn.execute(
                            "INSERT INTO post_images (id, post_id, filename, original_name, position, width, height) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                            rusqlite::params![img_id, id, img.filename, img.original_name, position as i32, img.width, img.height],
                        )
                        .ok();
                        if img.convert {
                            to_convert.push((img_id, img.filename.clone()));
                        }
                    }
                }
            }
        }

        // Re-extract tags
        conn.execute("DELETE FROM post_tags WHERE post_id = ?1", [&id])
            .ok();
        for tag in extract_tags(&content) {
            conn.execute(
                "INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?1, ?2)",
                rusqlite::params![id, tag],
            )
            .ok();
        }

        let old_urls: std::collections::HashSet<String> =
            extract_urls(&old_content).into_iter().collect();
        let new_urls: std::collections::HashSet<String> =
            extract_urls(&content).into_iter().collect();
        old_urls != new_urls
    };

    // Delete the files of removed images now their rows are gone — no dangling
    // files, and the rows never reference a missing file mid-request.
    for filename in removed_files {
        let _ = std::fs::remove_file(format!("uploads/images/{}", filename));
    }

    // Kick off background AVIF conversion for any newly uploaded images.
    for (img_id, filename) in to_convert {
        link_preview::spawn_avif_switch(
            db.clone(),
            "images",
            filename,
            link_preview::AvifSwitch::PostImage(img_id),
        );
    }

    // Re-resolve + attach link previews only when the links actually changed.
    if links_changed {
        attach_link_previews(&db, &id, &content).await;
    }

    let conn = db.conn();
    let post = build_post(&conn, &id)
        .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load updated post"))?;
    Ok(Json(serde_json::json!({ "post": post })))
}

pub async fn delete_post(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Path(id): Path<String>,
) -> Result<Json<MessageResponse>, ApiError> {
    let conn = db.conn();

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
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete post"))?;

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
