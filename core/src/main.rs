mod auth;
mod db;
mod handlers;
mod models;

use axum::{
    http::{header, HeaderValue},
    routing::{delete, get, post, put},
    Router,
};
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

// How often the background task resolves link previews for imported posts.
const BACKFILL_INTERVAL_SECS: u64 = 60;

#[tokio::main]
async fn main() {
    // Data (SQLite DB + uploads) is stored relative to the working directory.
    // The Docker image runs the binary from /data (a mounted volume).
    std::fs::create_dir_all("uploads/images").expect("Failed to create uploads/images");
    std::fs::create_dir_all("uploads/emojis").expect("Failed to create uploads/emojis");
    std::fs::create_dir_all("uploads/previews").expect("Failed to create uploads/previews");

    let db = db::init_db();

    // Background: auto-resolve link previews for imported posts (posts that have
    // URLs but no previews yet), rate-limited so a large import drains gradually.
    {
        let db = db.clone();
        println!(
            "Link previews: rate limit {}ms/fetch, import backfill every {}s",
            handlers::link_preview::RATE_LIMIT_MS,
            BACKFILL_INTERVAL_SECS
        );
        tokio::spawn(async move {
            loop {
                let n = handlers::posts::backfill_imported_previews(&db).await;
                if n > 0 {
                    println!("[previews] backfilled {} imported post(s)", n);
                }
                tokio::time::sleep(std::time::Duration::from_secs(BACKFILL_INTERVAL_SECS)).await;
            }
        });
    }

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        // Auth
        .route("/api/auth/signup", post(handlers::auth::signup))
        .route("/api/auth/signin", post(handlers::auth::signin))
        // Users
        .route("/api/users/me", get(handlers::users::get_me))
        .route("/api/users/me/password", put(handlers::users::change_password))
        .route("/api/users/me/username", put(handlers::users::change_username))
        .route("/api/users/me", delete(handlers::users::delete_account))
        // Posts
        .route("/api/posts", get(handlers::posts::list_posts))
        .route("/api/posts", post(handlers::posts::create_post))
        .route("/api/posts/:id", get(handlers::posts::get_post))
        .route("/api/posts/:id", put(handlers::posts::update_post))
        .route("/api/posts/:id", delete(handlers::posts::delete_post))
        // Tags
        .route("/api/tags", get(handlers::tags::list_tags))
        // Emojis
        .route("/api/emojis", get(handlers::emojis::list_emojis))
        .route("/api/emojis", post(handlers::emojis::upload_emoji))
        .route("/api/emojis/:id", delete(handlers::emojis::delete_emoji))
        // Search
        .route("/api/search", get(handlers::search::search_posts))
        // Link preview
        .route("/api/link-preview", post(handlers::link_preview::fetch_link_preview))
        // Static files
        .nest_service(
            "/uploads",
            ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                ))
                .service(ServeDir::new("uploads")),
        )
        .with_state(db)
        .layer(cors);

    println!("Backend running on http://localhost:3001");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, api).await.unwrap();
}
