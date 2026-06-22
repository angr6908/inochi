use axum::{extract::State, Json};

use crate::db::{query_rows, Db, DbExt};
use crate::models::*;

pub async fn list_tags(
    State(db): State<Db>,
) -> Result<Json<TagsResponse>, ApiError> {
    let conn = db.conn();
    let tags: Vec<TagInfo> = query_rows(
        &conn,
        "SELECT tag, COUNT(*) as cnt FROM post_tags GROUP BY tag ORDER BY cnt DESC",
        [],
        |r| {
            Ok(TagInfo {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        },
    );

    Ok(Json(TagsResponse { tags }))
}
