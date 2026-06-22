use axum::{extract::State, http::StatusCode, Json};

use crate::auth::AuthUser;
use crate::db::{Db, DbExt};
use crate::models::*;

fn verify_password(
    db: &Db,
    user_id: &str,
    password: &str,
    wrong_msg: &str,
) -> Result<(), ApiError> {
    // Read the hash under a short lock, then verify after releasing it — bcrypt
    // is ~100ms and the connection mutex serializes every request.
    let hash: String = {
        let conn = db.conn();
        conn.query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            [user_id],
            |r| r.get(0),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "User not found"))?
    };

    if !bcrypt::verify(password, &hash).unwrap_or(false) {
        return Err(err(StatusCode::UNAUTHORIZED, wrong_msg));
    }
    Ok(())
}

/// Load a user's public profile by id.
fn fetch_user(conn: &rusqlite::Connection, id: &str) -> rusqlite::Result<UserPublic> {
    conn.query_row(
        "SELECT id, username, created_at FROM users WHERE id = ?1",
        [id],
        |r| {
            Ok(UserPublic {
                id: r.get(0)?,
                username: r.get(1)?,
                created_at: r.get(2)?,
            })
        },
    )
}

pub async fn get_me(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
) -> Result<Json<UserPublic>, ApiError> {
    let conn = db.conn();
    let user = fetch_user(&conn, &user_id)
        .map_err(|_| err(StatusCode::NOT_FOUND, "User not found"))?;
    Ok(Json(user))
}

pub async fn change_password(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    verify_password(
        &db,
        &user_id,
        &body.current_password,
        "Current password is incorrect",
    )?;

    let new_hash = bcrypt::hash(&body.new_password, 10)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to hash password"))?;

    db.conn()
        .execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            rusqlite::params![new_hash, user_id],
        )
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update password"))?;

    Ok(Json(MessageResponse {
        message: "Password updated".into(),
    }))
}

pub async fn change_username(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Json(body): Json<ChangeUsernameRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if body.new_username.trim().is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Username cannot be empty"));
    }

    let conn = db.conn();
    conn.execute(
        "UPDATE users SET username = ?1 WHERE id = ?2",
        rusqlite::params![body.new_username.trim(), user_id],
    )
    .map_err(|_| err(StatusCode::CONFLICT, "Username already taken"))?;

    let user = fetch_user(&conn, &user_id)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load user"))?;

    Ok(Json(serde_json::json!({ "user": user })))
}

pub async fn delete_account(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
    Json(body): Json<DeleteAccountRequest>,
) -> Result<Json<MessageResponse>, ApiError> {
    verify_password(&db, &user_id, &body.password, "Password is incorrect")?;

    db.conn()
        .execute("DELETE FROM users WHERE id = ?1", [&user_id])
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete account"))?;

    Ok(Json(MessageResponse {
        message: "Account deleted".into(),
    }))
}
