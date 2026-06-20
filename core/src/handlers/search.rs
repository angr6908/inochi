use axum::{extract::{Query, State}, Json};

use crate::db::Db;
use crate::handlers::posts::{posts_page, query_ids, thread_cte, thread_ordered_select};
use crate::models::*;

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
    let pattern = format!("%{}%", q.trim());

    let conn = db.lock().unwrap();

    // Posts that actually match the query. The thread CTE expands these to whole
    // threads (for context); `matches` counts just these so the UI can report
    // real hits rather than the inflated thread total used for pagination.
    let matched = "SELECT p.id FROM posts p
         LEFT JOIN post_links pl ON pl.post_id = p.id
         LEFT JOIN link_previews lp ON lp.id = pl.link_preview_id
         WHERE p.content LIKE ?1
            OR lp.title LIKE ?1
            OR lp.description LIKE ?1
            OR lp.site_name LIKE ?1
            OR lp.author LIKE ?1
            OR lp.url LIKE ?1";
    let cte = thread_cte(matched);

    let total: i64 = conn
        .query_row(
            &format!("{cte} SELECT COUNT(*) FROM thread"),
            [&pattern],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let matches: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM (SELECT DISTINCT id FROM ({matched}))"),
            [&pattern],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let post_ids = query_ids(&conn, &thread_ordered_select(&cte, limit, offset), [&pattern]);

    let mut resp = posts_page(&conn, &post_ids, total, page, limit);
    resp.matches = Some(matches);
    Ok(Json(resp))
}
