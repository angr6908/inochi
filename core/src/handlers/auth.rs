use axum::{extract::State, http::StatusCode, Json};
use uuid::Uuid;

use crate::auth::create_token;
use crate::db::{Db, DbExt};
use crate::models::{err, ApiError, AuthRequest, AuthResponse, UserPublic};

pub async fn signup(
    State(db): State<Db>,
    Json(body): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    if body.username.trim().is_empty() || body.password.len() < 4 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "Username required and password must be at least 4 characters",
        ));
    }

    let id = Uuid::new_v4().to_string();
    let hash = bcrypt::hash(&body.password, 10)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to hash password"))?;

    let created_at: String = {
        let conn = db.conn();
        conn.execute(
            "INSERT INTO users (id, username, password_hash) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, body.username.trim(), hash],
        )
        .map_err(|_| err(StatusCode::CONFLICT, "Username already taken"))?;

        conn.query_row("SELECT created_at FROM users WHERE id = ?1", [&id], |r| {
            r.get(0)
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load created user"))?
    };

    let token = create_token(&id)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create token"))?;

    Ok(Json(AuthResponse {
        token,
        user: UserPublic {
            id,
            username: body.username.trim().to_string(),
            created_at,
        },
    }))
}

pub async fn signin(
    State(db): State<Db>,
    Json(body): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let result: Result<(String, String, String, String), _> = {
        let conn = db.conn();
        conn.query_row(
            "SELECT id, username, password_hash, created_at FROM users WHERE username = ?1",
            [body.username.trim()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
    };

    let (id, username, hash, created_at) =
        result.map_err(|_| err(StatusCode::UNAUTHORIZED, "Invalid credentials"))?;

    if !bcrypt::verify(&body.password, &hash).unwrap_or(false) {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid credentials"));
    }

    let token = create_token(&id)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create token"))?;

    Ok(Json(AuthResponse {
        token,
        user: UserPublic {
            id,
            username,
            created_at,
        },
    }))
}
