use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::{query_rows, Db, DbExt};
use crate::models::*;

pub async fn list_emojis(
    State(db): State<Db>,
) -> Result<Json<EmojisResponse>, ApiError> {
    let conn = db.conn();
    let emojis: Vec<EmojiInfo> = query_rows(
        &conn,
        "SELECT id, shortcode, filename FROM custom_emojis ORDER BY shortcode",
        [],
        |r| {
            Ok(EmojiInfo {
                id: r.get(0)?,
                shortcode: r.get(1)?,
                url: format!("/uploads/emojis/{}", r.get::<_, String>(2)?),
            })
        },
    );

    Ok(Json(EmojisResponse { emojis }))
}

pub async fn upload_emoji(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut shortcode = String::new();
    let mut emoji_file: Option<(String, bool)> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "shortcode" => {
                shortcode = field.text().await.unwrap_or_default();
            }
            "image" => {
                let original_name = field.file_name().unwrap_or("emoji.png").to_string();
                let data = field.bytes().await.unwrap_or_default().to_vec();
                if !data.is_empty() {
                    emoji_file =
                        crate::handlers::link_preview::save_original("emojis", &original_name, &data)
                            .await;
                }
            }
            _ => {}
        }
    }

    if shortcode.trim().is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Shortcode is required"));
    }

    let (filename, convert) =
        emoji_file.ok_or_else(|| err(StatusCode::BAD_REQUEST, "Image file is required"))?;

    let id = Uuid::new_v4().to_string();
    {
        let conn = db.conn();
        conn.execute(
            "INSERT INTO custom_emojis (id, shortcode, filename, uploaded_by) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, shortcode.trim(), filename, user_id],
        )
        .map_err(|_| err(StatusCode::CONFLICT, "Shortcode already exists"))?;
    }

    // Original is served immediately; convert to AVIF in the background.
    if convert {
        crate::handlers::link_preview::spawn_avif_switch(
            db.clone(),
            "emojis",
            filename.clone(),
            crate::handlers::link_preview::AvifSwitch::Emoji(id.clone()),
        );
    }

    let emoji = EmojiInfo {
        id,
        shortcode: shortcode.trim().to_string(),
        url: format!("/uploads/emojis/{}", filename),
    };

    Ok(Json(serde_json::json!({ "emoji": emoji })))
}

pub async fn delete_emoji(
    AuthUser(_user_id): AuthUser,
    State(db): State<Db>,
    Path(id): Path<String>,
) -> Result<Json<MessageResponse>, ApiError> {
    let conn = db.conn();

    let filename: String = conn
        .query_row(
            "SELECT filename FROM custom_emojis WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "Emoji not found"))?;

    conn.execute("DELETE FROM custom_emojis WHERE id = ?1", [&id])
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete emoji"))?;

    let _ = std::fs::remove_file(format!("uploads/emojis/{}", filename));

    Ok(Json(MessageResponse {
        message: "Emoji deleted".into(),
    }))
}
