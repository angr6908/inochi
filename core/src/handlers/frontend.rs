use std::path::Path;
use std::time::Duration;

use axum::{extract::State, http::StatusCode, Json};
use serde::de::DeserializeOwned;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::auth::AuthUser;
use crate::db::{Db, DbExt};
use crate::handlers::users::is_admin;
use crate::models::*;

const FETCHER: &str = "/usr/local/lib/inochi/fetch-web.mjs";
const FETCHER_TIMEOUT: Duration = Duration::from_secs(300);

static UPDATE: Mutex<()> = Mutex::const_new(());

fn require_admin(db: &Db, user_id: &str) -> Result<(), ApiError> {
    if is_admin(&db.conn(), user_id) {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "Only the site owner can update the frontend",
        ))
    }
}

async fn run_fetcher<T: DeserializeOwned>(mode: &str) -> Result<T, ApiError> {
    if !Path::new(FETCHER).exists() {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "Frontend updates are only available in the Docker image",
        ));
    }
    let output = tokio::time::timeout(
        FETCHER_TIMEOUT,
        Command::new("node")
            .arg(FETCHER)
            .arg(mode)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| err(StatusCode::GATEWAY_TIMEOUT, "Timed out reaching GitLab"))?
    .map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to start the frontend fetcher",
        )
    })?;
    if !output.status.success() {
        let reason = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(err(
            StatusCode::BAD_GATEWAY,
            if reason.is_empty() {
                "Frontend fetcher failed".to_string()
            } else {
                reason
            },
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unexpected frontend fetcher output",
        )
    })
}

pub async fn status(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
) -> Result<Json<FrontendStatus>, ApiError> {
    require_admin(&db, &user_id)?;
    Ok(Json(run_fetcher("--check").await?))
}

pub async fn update(
    AuthUser(user_id): AuthUser,
    State(db): State<Db>,
) -> Result<Json<FrontendUpdate>, ApiError> {
    require_admin(&db, &user_id)?;
    let _running = UPDATE
        .try_lock()
        .map_err(|_| err(StatusCode::CONFLICT, "An update is already running"))?;
    Ok(Json(run_fetcher("--update").await?))
}
