use axum::{extract::State, Json};

use crate::db::Db;
use crate::models::*;

pub async fn list_tags(
    State(db): State<Db>,
) -> Result<Json<TagsResponse>, ApiError> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT tag, COUNT(*) as cnt FROM post_tags GROUP BY tag ORDER BY cnt DESC")
        .unwrap();
    let tags: Vec<TagInfo> = stmt
        .query_map([], |r| {
            Ok(TagInfo {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(TagsResponse { tags }))
}
