use axum::{extract::{Query, State}, Json};

use crate::db::Db;
use crate::handlers::posts::{posts_page, query_ids};
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
        }));
    }

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).min(100);
    let offset = (page - 1) * limit;
    let pattern = format!("%{}%", q.trim());

    let conn = db.lock().unwrap();

    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM posts WHERE content LIKE ?1",
            [&pattern],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let post_ids = query_ids(
        &conn,
        &format!(
            "SELECT id FROM posts WHERE content LIKE ?1 ORDER BY created_at DESC LIMIT {} OFFSET {}",
            limit, offset
        ),
        [&pattern],
    );

    Ok(Json(posts_page(&conn, &post_ids, total, page, limit)))
}
