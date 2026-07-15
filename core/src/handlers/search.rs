use axum::{
    extract::{Query, State},
    Json,
};

use crate::db::{Db, DbExt};
use crate::handlers::posts::{posts_page, query_ids, thread_cte, thread_ordered_select};
use crate::models::*;

/// Each term adds a correlated EXISTS subquery over every post, so the work
/// scales with the term count. `q` is caller-supplied, so cap it: past this many
/// terms a query is not a real search, and the extra terms only narrow an AND
/// that is already narrow.
const MAX_TERMS: usize = 16;

fn like_pattern(term: &str) -> String {
    let escaped = term
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn matched_posts_sql(term_count: usize) -> String {
    let terms = (1..=term_count)
        .map(|i| {
            format!(
                "(p.content LIKE ?{i} ESCAPE '\\'
                  OR EXISTS (
                    SELECT 1 FROM post_links pl
                    JOIN link_previews lp ON lp.id = pl.link_preview_id
                    WHERE pl.post_id = p.id
                      AND (lp.title LIKE ?{i} ESCAPE '\\'
                        OR lp.description LIKE ?{i} ESCAPE '\\'
                        OR lp.site_name LIKE ?{i} ESCAPE '\\'
                        OR lp.author LIKE ?{i} ESCAPE '\\'
                        OR lp.url LIKE ?{i} ESCAPE '\\')
                  ))"
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    format!("SELECT p.id FROM posts p WHERE {terms}")
}

pub async fn search_posts(
    State(db): State<Db>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<PostsListResponse>, ApiError> {
    let q = query.q.unwrap_or_default();
    if q.trim().is_empty() {
        return Ok(Json(PostsListResponse {
            posts: vec![],
            total: 0,
            page: 1,
            pages: 0,
            matches: None,
        }));
    }

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(100);
    let offset = (page - 1) * limit;
    let patterns = q
        .split_whitespace()
        .take(MAX_TERMS)
        .map(like_pattern)
        .collect::<Vec<_>>();

    let conn = db.conn();

    // Posts that actually match the query. The thread CTE expands these to whole
    // threads (for context); `matches` counts just these so the UI can report
    // real hits rather than the inflated thread total used for pagination. Each
    // whitespace-separated term must match, but terms may occur in different
    // positions or searchable fields (including different previews on one post).
    let matched = matched_posts_sql(patterns.len());
    let cte = thread_cte(&matched);

    let total: i64 = conn
        .query_row(
            &format!("{cte} SELECT COUNT(*) FROM thread"),
            rusqlite::params_from_iter(patterns.iter()),
            |r| r.get(0),
        )
        .unwrap_or(0);

    let matches: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM ({matched})"),
            rusqlite::params_from_iter(patterns.iter()),
            |r| r.get(0),
        )
        .unwrap_or(0);

    let post_ids = query_ids(
        &conn,
        &thread_ordered_select(&cte, limit, offset),
        rusqlite::params_from_iter(patterns.iter()),
    );

    let mut resp = posts_page(&conn, &post_ids, total, page, limit);
    resp.matches = Some(matches);
    Ok(Json(resp))
}
