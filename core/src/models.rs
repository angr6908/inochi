use axum::{http::StatusCode, Json};
use serde::{Deserialize, Serialize};

/// Standard handler error: an HTTP status paired with a JSON `{ "error": ... }`
/// body. Every fallible handler returns `Result<_, ApiError>`.
pub type ApiError = (StatusCode, Json<ErrorResponse>);

/// Build an [`ApiError`] from a status code and message.
pub fn err(code: StatusCode, message: impl Into<String>) -> ApiError {
    (
        code,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

// --- Auth ---
#[derive(Deserialize)]
pub struct AuthRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
}

// --- User ---
#[derive(Serialize, Clone)]
pub struct UserPublic {
    pub id: String,
    pub username: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct ChangeUsernameRequest {
    pub new_username: String,
}

#[derive(Deserialize)]
pub struct DeleteAccountRequest {
    pub password: String,
}

// --- Post ---
#[derive(Serialize, Clone)]
pub struct PostResponse {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub parent_post_id: Option<String>,
    pub root_post_id: String,
    pub parent_post: Option<ParentPostSummary>,
    pub content: String,
    pub images: Vec<ImageInfo>,
    pub link_previews: Vec<LinkPreviewInfo>,
    pub tags: Vec<String>,
    pub followup_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone)]
pub struct ParentPostSummary {
    pub id: String,
    pub username: String,
    pub content: String,
    pub created_at: String,
    pub images: Vec<ImageInfo>,
    pub link_previews: Vec<LinkPreviewInfo>,
}

#[derive(Serialize, Clone)]
pub struct ImageInfo {
    pub id: String,
    pub url: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Serialize, Clone, Deserialize)]
pub struct LinkPreviewInfo {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    /// Original (remote) OG/oEmbed image URL.
    pub image_url: Option<String>,
    /// Locally-saved copy of the thumbnail, served from this server (the source
    /// format first, then `/uploads/previews/<uuid>.avif` once converted).
    /// Preferred by the client over `image_url`.
    pub thumbnail: Option<String>,
    pub site_name: Option<String>,
    pub author: Option<String>,
    /// Pixel dimensions of the locally-saved thumbnail, so the client can reserve
    /// the card's image box at the real aspect ratio before the image loads (no
    /// layout shift). `None` when the thumbnail download/measure failed — the
    /// client then falls back to a fixed 16:9 box.
    #[serde(default)]
    pub image_width: Option<i64>,
    #[serde(default)]
    pub image_height: Option<i64>,
    /// Every image in the preview, in order, when there is more than one (e.g. a
    /// tweet with several photos). Image 0 mirrors `image_url`/`thumbnail`; the
    /// rest are the extras. Empty for single-image previews — the client then
    /// renders the lone `thumbnail`/`image_url` as before.
    #[serde(default)]
    pub images: Vec<PreviewImage>,
}

#[derive(Serialize, Clone, Deserialize)]
pub struct PreviewImage {
    /// Original (remote) image URL.
    pub image_url: Option<String>,
    /// Locally-saved copy, served from this server. Preferred by the client.
    pub thumbnail: Option<String>,
    /// Pixel dimensions of the locally-saved copy (see `LinkPreviewInfo`).
    #[serde(default)]
    pub image_width: Option<i64>,
    #[serde(default)]
    pub image_height: Option<i64>,
}

#[derive(Deserialize)]
pub struct PostsQuery {
    pub page: Option<u32>,
    pub limit: Option<u32>,
    pub tag: Option<String>,
}

#[derive(Serialize)]
pub struct PostsListResponse {
    pub posts: Vec<PostResponse>,
    pub total: i64,
    pub page: u32,
    pub pages: u32,
    // Number of posts that actually matched the query, as opposed to `total`,
    // which counts every post in the matched threads (used for pagination).
    // Only set for search; omitted from the timeline/tag responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matches: Option<i64>,
}

#[derive(Serialize)]
pub struct PostDetailResponse {
    pub post: PostResponse,
    pub followups: Vec<PostResponse>,
}

// --- Tag ---
#[derive(Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct TagsResponse {
    pub tags: Vec<TagInfo>,
}

// --- Emoji ---
#[derive(Serialize, Clone)]
pub struct EmojiInfo {
    pub id: String,
    pub shortcode: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct EmojisResponse {
    pub emojis: Vec<EmojiInfo>,
}

// --- Search ---
#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

// --- Link Preview ---
#[derive(Deserialize)]
pub struct LinkPreviewRequest {
    pub url: String,
}

// --- Generic ---
#[derive(Serialize)]
pub struct MessageResponse {
    pub message: String,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}
