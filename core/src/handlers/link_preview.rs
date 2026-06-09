use axum::{extract::State, http::StatusCode, Json};
use scraper::{Html, Selector};
use uuid::Uuid;

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::auth::AuthUser;
use crate::db::Db;
use crate::models::*;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Process-wide rate limiter for outbound preview fetches. Every external
/// resolve (live posts, the editor endpoint, and the import backfill) funnels
/// through one limiter, so we never hammer YouTube/X/Twitch regardless of how
/// many links are imported at once. Reservation-based: concurrent callers are
/// each handed a distinct future slot spaced `interval` apart.
struct RateLimiter {
    interval: Duration,
    next: tokio::sync::Mutex<Instant>,
}

impl RateLimiter {
    async fn acquire(&self) {
        if self.interval.is_zero() {
            return;
        }
        let scheduled = {
            let mut next = self.next.lock().await;
            let slot = (*next).max(Instant::now());
            *next = slot + self.interval;
            slot
        };
        let wait = scheduled.saturating_duration_since(Instant::now());
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
}

static LIMITER: OnceLock<RateLimiter> = OnceLock::new();

/// Minimum gap between outbound preview fetches (≈ 2 requests/sec).
pub const RATE_LIMIT_MS: u64 = 500;

fn limiter() -> &'static RateLimiter {
    LIMITER.get_or_init(|| RateLimiter {
        interval: Duration::from_millis(RATE_LIMIT_MS),
        next: tokio::sync::Mutex::new(Instant::now()),
    })
}

static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

/// Shared HTTP client — built once so its connection pool/keep-alive is reused
/// across every preview fetch (including a large import backfill).
fn http_client() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// Map a `link_previews` row into a [`LinkPreviewInfo`], reading the seven
/// columns `url, title, description, image_url, thumbnail, site_name, author`
/// starting at index `base`. Used by every read site so the column list lives
/// in one place.
pub(crate) fn preview_from_row(
    r: &rusqlite::Row,
    base: usize,
) -> rusqlite::Result<LinkPreviewInfo> {
    Ok(LinkPreviewInfo {
        url: r.get(base)?,
        title: r.get(base + 1)?,
        description: r.get(base + 2)?,
        image_url: r.get(base + 3)?,
        thumbnail: r.get(base + 4)?,
        site_name: r.get(base + 5)?,
        author: r.get(base + 6)?,
    })
}

/// Whether a freshly-saved image with this extension should be background-
/// converted to AVIF. Already-compact, animated, or vector formats are left
/// as-is (AVIF/SVG/GIF).
fn should_convert(ext: &str) -> bool {
    !matches!(ext, "avif" | "svg" | "gif")
}

/// Lowercased host without a leading `www.`.
fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_lowercase()
}

fn scheme_authority(url: &str) -> (String, String) {
    let scheme = url.split("://").next().unwrap_or("https").to_string();
    let authority = url
        .split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    (scheme, authority)
}

/// Resolve a possibly-relative URL (e.g. an `og:image`) against its page URL.
fn resolve_url(base: &str, link: &str) -> String {
    if link.is_empty() || link.starts_with("http://") || link.starts_with("https://") {
        return link.to_string();
    }
    let (scheme, authority) = scheme_authority(base);
    if let Some(rest) = link.strip_prefix("//") {
        format!("{}://{}", scheme, rest)
    } else if link.starts_with('/') {
        format!("{}://{}{}", scheme, authority, link)
    } else {
        format!("{}://{}/{}", scheme, authority, link)
    }
}

/// Pretty default site name for hosts that don't expose `og:site_name`.
fn default_site_name(host: &str) -> String {
    if host.contains("youtube") || host.contains("youtu.be") {
        return "YouTube".into();
    }
    if host == "x.com" || host.contains("twitter.com") {
        return "X".into();
    }
    if host.contains("twitch.tv") {
        return "Twitch".into();
    }
    let label = host.split('.').next().unwrap_or(host);
    let mut chars = label.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => host.to_string(),
    }
}

/// Map an x.com / twitter.com status URL onto the FixTweet JSON API, which
/// exposes tweet text, author, and media without authentication (X killed its
/// own public oEmbed). Path is preserved: `x.com/nasa/status/1` ->
/// `api.fxtwitter.com/nasa/status/1`.
fn fxtwitter_api(url: &str) -> String {
    let after = url.split("://").nth(1).unwrap_or(url);
    let path = after.split_once('/').map(|(_, p)| p).unwrap_or("");
    let path = path.split(['?', '#']).next().unwrap_or(path);
    format!("https://api.fxtwitter.com/{}", path)
}

struct Og {
    title: Option<String>,
    description: Option<String>,
    image: Option<String>,
    site_name: Option<String>,
    author: Option<String>,
}

/// Parse OpenGraph / Twitter / standard meta tags. Synchronous so the
/// (non-`Send`) `scraper::Html` is dropped before any `.await`.
fn parse_og(html_text: &str) -> Og {
    let document = Html::parse_document(html_text);
    let meta_prop = |property: &str| -> Option<String> {
        let sel = Selector::parse(&format!("meta[property=\"{}\"]", property)).ok()?;
        document
            .select(&sel)
            .next()
            .and_then(|el| el.value().attr("content"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let meta_name = |name: &str| -> Option<String> {
        let sel = Selector::parse(&format!("meta[name=\"{}\"]", name)).ok()?;
        document
            .select(&sel)
            .next()
            .and_then(|el| el.value().attr("content"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };

    let title = meta_prop("og:title")
        .or_else(|| meta_name("twitter:title"))
        .or_else(|| {
            let sel = Selector::parse("title").ok()?;
            document
                .select(&sel)
                .next()
                .map(|el| el.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty())
        });
    let description = meta_prop("og:description")
        .or_else(|| meta_name("twitter:description"))
        .or_else(|| meta_name("description"));
    let image = meta_prop("og:image")
        .or_else(|| meta_prop("og:image:url"))
        .or_else(|| meta_name("twitter:image"))
        .or_else(|| meta_name("twitter:image:src"));
    let site_name = meta_prop("og:site_name");
    let author = meta_prop("article:author")
        .or_else(|| meta_name("author"))
        .or_else(|| meta_name("twitter:creator"))
        // Some sites put a URL in article:author — not a display name.
        .filter(|s| !s.starts_with("http"));

    Og {
        title,
        description,
        image,
        site_name,
        author,
    }
}

async fn fetch_oembed(
    client: &reqwest::Client,
    base: &str,
    params: &[(&str, &str)],
) -> Option<serde_json::Value> {
    let resp = client.get(base).query(params).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().await.ok()
}

fn dedup(v: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    v.into_iter().filter(|s| seen.insert(s.clone())).collect()
}

/// Higher-quality renditions of a thumbnail URL, best first, with the original
/// last as a fallback. Providers expose larger images via predictable URL
/// tweaks: YouTube `maxresdefault` (1280×720), Twitch `600x600`, X `_400x400`.
fn thumbnail_candidates(url: &str) -> Vec<String> {
    // YouTube: i.ytimg.com/vi/<id>/<file>. The og:image is often a hover frame
    // (hqN.jpg) or low-res default, so rebuild the canonical thumbnails. Shorts
    // expose a vertical `oardefault.jpg`; regular videos use `maxresdefault.jpg`
    // (their `oardefault` 404s, so it's tried first and falls through).
    if url.contains("ytimg.com") {
        if let Some((base, _)) = url.rsplit_once('/') {
            return dedup(vec![
                format!("{}/oardefault.jpg", base),
                format!("{}/maxresdefault.jpg", base),
                format!("{}/sddefault.jpg", base),
                format!("{}/hqdefault.jpg", base),
                url.to_string(),
            ]);
        }
    }

    let mut out = Vec::new();
    // Twitch profile image: ...-profile_image-300x300.png
    if url.contains("300x300") {
        out.push(url.replace("300x300", "600x600"));
    }
    // X/Twitter avatar: ..._200x200.jpg or ..._normal.jpg
    if url.contains("_200x200") {
        out.push(url.replace("_200x200", "_400x400"));
    } else if url.contains("_normal.") {
        out.push(url.replace("_normal.", "_400x400."));
    }
    out.push(url.to_string());
    dedup(out)
}

/// Download the best available rendition, trying candidates highest-quality
/// first and falling back when one is missing (e.g. no `maxresdefault`).
async fn download_best(client: &reqwest::Client, candidates: &[String]) -> Option<String> {
    for cand in candidates {
        if let Some(path) = download_thumbnail(client, cand).await {
            return Some(path);
        }
    }
    None
}

/// Encode an on-disk image to AVIF (`avifenc -s 0 -d 10`, slowest/highest
/// quality). `avifenc` reads JPEG/PNG directly; other formats (WebP, …) are
/// decoded to PNG with `vips` first. Returns `None` if a step fails.
async fn avif_encode_file(src: &str) -> Option<Vec<u8>> {
    let ext = src.rsplit('.').next().unwrap_or("").to_lowercase();
    let stem = Uuid::new_v4();
    let tmp = std::env::temp_dir();
    let png = tmp.join(format!("inochi-{stem}.png"));
    let out = tmp.join(format!("inochi-{stem}.avif"));

    let avif_in: std::path::PathBuf = if matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
        std::path::PathBuf::from(src)
    } else {
        let decoded = tokio::process::Command::new("vips")
            .arg("copy")
            .arg(src)
            .arg(&png)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        if !decoded {
            return None;
        }
        png.clone()
    };

    let encoded = tokio::process::Command::new("avifenc")
        .args(["-s", "0", "-d", "10"])
        .arg(&avif_in)
        .arg(&out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    let bytes = if encoded {
        tokio::fs::read(&out).await.ok()
    } else {
        None
    };

    let _ = tokio::fs::remove_file(&png).await;
    let _ = tokio::fs::remove_file(&out).await;
    bytes.filter(|b| !b.is_empty())
}

/// Already-AVIF (ISO-BMFF `ftyp` box with an `avif`/`avis` brand).
fn is_avif(b: &[u8]) -> bool {
    b.len() >= 12 && &b[4..8] == b"ftyp" && matches!(&b[8..12], b"avif" | b"avis")
}

/// Save an uploaded image under `uploads/{dir}` in its original format. Returns
/// `(filename, convert)` where `convert` is true when a background AVIF
/// conversion should follow (the source isn't already AVIF/SVG/GIF).
pub(crate) async fn save_original(dir: &str, original_name: &str, data: &[u8]) -> Option<(String, bool)> {
    let ext = if is_avif(data) {
        "avif".to_string()
    } else {
        original_name.rsplit('.').next().unwrap_or("bin").to_lowercase()
    };
    let convert = should_convert(&ext);
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    tokio::fs::write(format!("uploads/{dir}/{filename}"), data)
        .await
        .ok()?;
    Some((filename, convert))
}

/// Which stored reference to flip once a background conversion produces AVIF.
pub(crate) enum AvifSwitch {
    PostImage(String),
    Preview(String),
    Emoji(String),
}

/// Process-wide AVIF-encode lock. `avifenc -s 0` is itself fully multithreaded,
/// so we run at most one encode at a time — concurrent uploads queue here rather
/// than oversubscribing every core N times over.
static AVIF_ENCODE_LOCK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// Background: convert the just-saved original at `uploads/{dir}/{orig}` to AVIF,
/// switch the stored reference to the `.avif` file, and delete the original.
/// Encodes run serially (see `AVIF_ENCODE_LOCK`). No-op if encoding fails — the
/// original keeps being served.
pub(crate) fn spawn_avif_switch(db: Db, dir: &'static str, orig: String, switch: AvifSwitch) {
    tokio::spawn(async move {
        let src = format!("uploads/{dir}/{orig}");
        // Hold the lock only across the CPU-heavy encode; the file write and DB
        // update below are cheap I/O and need not be serialized.
        let encoded = {
            let _permit = AVIF_ENCODE_LOCK.acquire().await;
            avif_encode_file(&src).await
        };
        let Some(bytes) = encoded else {
            return;
        };
        let stem = orig.rsplit_once('.').map(|(s, _)| s).unwrap_or(&orig);
        let avif = format!("{stem}.avif");
        if tokio::fs::write(format!("uploads/{dir}/{avif}"), &bytes)
            .await
            .is_err()
        {
            return;
        }
        {
            let conn = db.lock().unwrap();
            match &switch {
                AvifSwitch::PostImage(id) => conn.execute(
                    "UPDATE post_images SET filename = ?1 WHERE id = ?2",
                    rusqlite::params![avif, id],
                ),
                AvifSwitch::Preview(id) => conn.execute(
                    "UPDATE link_previews SET thumbnail = ?1 WHERE id = ?2",
                    rusqlite::params![format!("/uploads/previews/{avif}"), id],
                ),
                AvifSwitch::Emoji(id) => conn.execute(
                    "UPDATE custom_emojis SET filename = ?1 WHERE id = ?2",
                    rusqlite::params![avif, id],
                ),
            }
            .ok();
        }
        let _ = tokio::fs::remove_file(&src).await;
    });
}

fn ext_from_content_type(ct: &str) -> &'static str {
    let ct = ct.to_lowercase();
    if ct.contains("png") {
        "png"
    } else if ct.contains("webp") {
        "webp"
    } else if ct.contains("avif") {
        "avif"
    } else if ct.contains("gif") {
        "gif"
    } else if ct.contains("svg") {
        "svg"
    } else {
        "jpg"
    }
}

/// Download a remote image into `uploads/previews/` in its original format and
/// return its served path. Conversion to AVIF runs in the background once the
/// row is stored (see `resolve_and_cache`).
async fn download_thumbnail(client: &reqwest::Client, remote: &str) -> Option<String> {
    let resp = client.get(remote).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ext = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(ext_from_content_type)
        .unwrap_or("jpg");
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    tokio::fs::write(format!("uploads/previews/{}", filename), &bytes)
        .await
        .ok()?;
    Some(format!("/uploads/previews/{}", filename))
}

/// Twitch's public web Client-ID (used by twitch.tv itself) for unauthenticated
/// GQL queries — pages serve only generic OG tags to bots.
const TWITCH_GQL_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";

enum TwitchTarget {
    Clip(String),
    Video(String),
    Channel(String),
}

/// Classify a Twitch URL as a clip, VOD, or channel (live/offline).
fn twitch_target(url: &str) -> Option<TwitchTarget> {
    let host = host_of(url);
    let after = url.split("://").nth(1).unwrap_or(url);
    let path = after.split_once('/').map(|(_, p)| p).unwrap_or("");
    let segs: Vec<&str> = path.split(['/', '?', '#']).filter(|s| !s.is_empty()).collect();
    if host.starts_with("clips.") {
        return segs.first().map(|s| TwitchTarget::Clip(s.to_string()));
    }
    if let Some(pos) = segs.iter().position(|s| *s == "clip") {
        if let Some(slug) = segs.get(pos + 1) {
            return Some(TwitchTarget::Clip(slug.to_string()));
        }
    }
    if matches!(segs.first(), Some(&"videos")) {
        if let Some(id) = segs.get(1).filter(|id| id.chars().all(|c| c.is_ascii_digit())) {
            return Some(TwitchTarget::Video(id.to_string()));
        }
    }
    let reserved = [
        "videos", "directory", "settings", "p", "u", "team", "subs", "clips", "downloads", "jobs",
    ];
    match segs.first() {
        Some(s) if !reserved.contains(s) => Some(TwitchTarget::Channel(s.to_string())),
        _ => None,
    }
}

/// POST a GraphQL query to Twitch's public gateway with the web Client-ID.
async fn twitch_gql(client: &reqwest::Client, query: String) -> Option<serde_json::Value> {
    let resp = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-Id", TWITCH_GQL_CLIENT_ID)
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().await.ok()
}

/// Resolve a Twitch clip or channel via GQL into
/// `(title, image_url, author, description)`. For a live channel this is the
/// current stream's title/preview; offline falls back to the channel itself.
async fn twitch_preview(
    client: &reqwest::Client,
    target: &TwitchTarget,
) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let s = |v: &serde_json::Value| v.as_str().map(str::to_string);
    match target {
        TwitchTarget::Clip(slug) => {
            let q = format!(
                r#"{{clip(slug:"{}"){{title thumbnailURL broadcaster{{displayName}} game{{displayName}}}}}}"#,
                slug
            );
            let Some(j) = twitch_gql(client, q).await else {
                return (None, None, None, None);
            };
            let c = match j.pointer("/data/clip") {
                Some(c) if !c.is_null() => c,
                _ => return (None, None, None, None),
            };
            let desc = c
                .pointer("/game/displayName")
                .and_then(s)
                .map(|g| format!("Clip · {}", g));
            (
                c.get("title").and_then(s),
                c.get("thumbnailURL").and_then(s),
                c.pointer("/broadcaster/displayName").and_then(s),
                desc,
            )
        }
        TwitchTarget::Video(id) => {
            let q = format!(
                r#"{{video(id:"{}"){{title previewThumbnailURL(width:1280,height:720) owner{{displayName}} game{{displayName}}}}}}"#,
                id
            );
            let Some(j) = twitch_gql(client, q).await else {
                return (None, None, None, None);
            };
            let v = match j.pointer("/data/video") {
                Some(v) if !v.is_null() => v,
                _ => return (None, None, None, None),
            };
            let desc = v
                .pointer("/game/displayName")
                .and_then(s)
                .map(|g| format!("Video · {}", g))
                .or_else(|| Some("Twitch video".to_string()));
            (
                v.get("title").and_then(s),
                v.get("previewThumbnailURL").and_then(s),
                v.pointer("/owner/displayName").and_then(s),
                desc,
            )
        }
        TwitchTarget::Channel(login) => {
            let q = format!(
                r#"{{user(login:"{}"){{displayName profileImageURL(width:300) stream{{title previewImageURL game{{displayName}}}}}}}}"#,
                login
            );
            let Some(j) = twitch_gql(client, q).await else {
                return (None, None, None, None);
            };
            let u = match j.pointer("/data/user") {
                Some(u) if !u.is_null() => u,
                _ => return (None, None, None, None),
            };
            let display = u.get("displayName").and_then(s);
            let stream = u.get("stream");
            if stream.map(|v| !v.is_null()).unwrap_or(false) {
                let st = stream.unwrap();
                let image = st
                    .get("previewImageURL")
                    .and_then(s)
                    .map(|t| t.replace("{width}", "1280").replace("{height}", "720"));
                let desc = match st.pointer("/game/displayName").and_then(s) {
                    Some(g) => format!("🔴 Live · {}", g),
                    None => "🔴 Live".to_string(),
                };
                (st.get("title").and_then(s), image, display, Some(desc))
            } else {
                (
                    display.clone(),
                    u.get("profileImageURL").and_then(s),
                    display,
                    Some("Twitch".to_string()),
                )
            }
        }
    }
}

/// Resolve a URL into preview metadata (oEmbed for YouTube/X, GQL for Twitch,
/// OpenGraph otherwise) and download its thumbnail locally.
async fn build_preview(url: &str) -> LinkPreviewInfo {
    limiter().acquire().await;
    let client = http_client();
    let host = host_of(url);
    let is_youtube = host.contains("youtube") || host.contains("youtu.be");
    let is_twitter = host == "x.com" || host.contains("twitter.com");
    let is_twitch = host.contains("twitch.tv");
    // Twitch serves generic OG tags to bots; clips, VODs, and channels resolve via GQL.
    let twitch_t = if is_twitch { twitch_target(url) } else { None };

    let mut title = None;
    let mut description = None;
    let mut image_url = None;
    let mut site_name = None;
    let mut author = None;

    // OpenGraph from the page HTML. Skipped for X/Twitter (JS login wall) and
    // for Twitch targets resolved via GQL below.
    if !is_twitter && twitch_t.is_none() {
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(html_text) = resp.text().await {
                let og = parse_og(&html_text);
                title = og.title;
                description = og.description;
                image_url = og.image;
                site_name = og.site_name;
                author = og.author;
            }
        }
    }

    // oEmbed enrichment — reliable channel/creator/author names + thumbnails.
    if is_youtube {
        if let Some(j) = fetch_oembed(
            client,
            "https://www.youtube.com/oembed",
            &[("url", url), ("format", "json")],
        )
        .await
        {
            // oEmbed title is authoritative — YouTube serves a placeholder
            // `- YouTube` OG title for freshly-published videos.
            if let Some(s) = j.get("title").and_then(|v| v.as_str()) {
                if !s.is_empty() {
                    title = Some(s.to_string());
                }
            }
            if let Some(s) = j.get("author_name").and_then(|v| v.as_str()) {
                author = Some(s.to_string());
            }
            if let Some(s) = j.get("thumbnail_url").and_then(|v| v.as_str()) {
                image_url = Some(s.to_string());
            }
            if let Some(s) = j.get("provider_name").and_then(|v| v.as_str()) {
                site_name.get_or_insert_with(|| s.to_string());
            }
        }
    } else if is_twitter {
        if let Some(j) = fetch_oembed(client, &fxtwitter_api(url), &[]).await {
            if let Some(tweet) = j.get("tweet") {
                let name = tweet.pointer("/author/name").and_then(|v| v.as_str());
                let screen = tweet.pointer("/author/screen_name").and_then(|v| v.as_str());
                author = match (name, screen) {
                    (Some(n), Some(s)) => Some(format!("{} (@{})", n, s)),
                    (Some(n), None) => Some(n.to_string()),
                    (None, Some(s)) => Some(format!("@{}", s)),
                    _ => None,
                };
                // The tweet body is the card's title for X.
                if let Some(txt) = tweet.get("text").and_then(|v| v.as_str()) {
                    if !txt.is_empty() {
                        title = Some(txt.to_string());
                        description = Some(txt.to_string());
                    }
                }
                // Thumbnail: first photo, else a video's thumbnail, else avatar.
                image_url = tweet
                    .pointer("/media/photos/0/url")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        tweet
                            .pointer("/media/videos/0/thumbnail_url")
                            .and_then(|v| v.as_str())
                    })
                    .or_else(|| tweet.pointer("/author/avatar_url").and_then(|v| v.as_str()))
                    .map(|s| s.to_string());
            }
            site_name.get_or_insert_with(|| "X".to_string());
        }
    }

    // Twitch clips, VODs, and channels: resolve title/thumbnail/author via GQL.
    if let Some(t) = &twitch_t {
        let (t_title, t_image, t_author, t_desc) = twitch_preview(client, t).await;
        if t_title.is_some() {
            title = t_title;
        }
        if t_image.is_some() {
            image_url = t_image;
        }
        if t_author.is_some() {
            author = t_author;
        }
        if t_desc.is_some() {
            description = t_desc;
        }
    }

    let site_name = site_name.or_else(|| Some(default_site_name(&host)));

    // Download the thumbnail so it is served from this server.
    let thumbnail = if let Some(img) = image_url.clone() {
        let abs = resolve_url(url, &img);
        image_url = Some(abs.clone());
        download_best(client, &thumbnail_candidates(&abs)).await
    } else {
        None
    };

    LinkPreviewInfo {
        url: url.to_string(),
        title,
        description,
        image_url,
        thumbnail,
        site_name,
        author,
    }
}

/// Resolve `url` (using the cache) and return `(link_preview_id, info)`.
/// Reused by both the HTTP endpoint and post creation/editing.
pub async fn resolve_and_cache(db: &Db, url: &str) -> Option<(String, LinkPreviewInfo)> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return None;
    }

    // Twitch channels are live/dynamic: each post snapshots the current stream,
    // so they bypass the shared URL cache — the same link posted at different
    // times keeps each moment's title/thumbnail (and is never re-resolved).
    let dynamic = matches!(twitch_target(&url), Some(TwitchTarget::Channel(_)));

    if !dynamic {
        // Cache lookup (lock released before any network I/O).
        let cached: Option<(String, LinkPreviewInfo)> = {
            let conn = db.lock().unwrap();
            conn.query_row(
                "SELECT id, url, title, description, image_url, thumbnail, site_name, author
                 FROM link_previews WHERE url = ?1",
                [&url],
                |r| Ok((r.get::<_, String>(0)?, preview_from_row(r, 1)?)),
            )
            .ok()
        };

        if let Some((id, info)) = cached {
            return Some((id, info));
        }
    }

    // Fresh resolve (dynamic source, or cache miss). The network fetch below runs
    // without the lock, so the top-of-function cache check may now be stale.
    let info = build_preview(&url).await;
    let id = Uuid::new_v4().to_string();

    // Re-check the cache under the lock, then insert only if still absent — as one
    // atomic step. A concurrent resolve (a new post's `attach_link_previews`
    // racing the 60s backfill pass, or two live-preview requests) can insert this
    // URL while we fetch; the shared DB mutex serializes us, so reusing whatever
    // appeared keeps one link to one preview row instead of two cards. Dynamic
    // Twitch channels intentionally snapshot per post and always insert.
    let existing: Option<(String, LinkPreviewInfo)> = {
        let conn = db.lock().unwrap();
        let found = if dynamic {
            None
        } else {
            conn.query_row(
                "SELECT id, url, title, description, image_url, thumbnail, site_name, author
                 FROM link_previews WHERE url = ?1",
                [&url],
                |r| Ok((r.get::<_, String>(0)?, preview_from_row(r, 1)?)),
            )
            .ok()
        };
        if found.is_none() {
            conn.execute(
                "INSERT INTO link_previews (id, url, title, description, image_url, thumbnail, site_name, author)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    id,
                    info.url,
                    info.title,
                    info.description,
                    info.image_url,
                    info.thumbnail,
                    info.site_name,
                    info.author
                ],
            )
            .ok();
        }
        found
    };

    // Lost the race: reuse the row that won and discard the thumbnail we just
    // downloaded (ours was never inserted, so nothing else will clean it up).
    if let Some(reused) = existing {
        if let Some(name) = info.thumbnail.as_deref().and_then(|t| t.rsplit('/').next()) {
            let _ = std::fs::remove_file(format!("uploads/previews/{}", name));
        }
        return Some(reused);
    }

    // The thumbnail was saved in its original format — convert it to AVIF in the
    // background, then switch the row to the `.avif` file.
    if let Some(name) = info.thumbnail.as_deref().and_then(|t| t.rsplit('/').next()) {
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        if should_convert(&ext) {
            spawn_avif_switch(db.clone(), "previews", name.to_string(), AvifSwitch::Preview(id.clone()));
        }
    }

    Some((id, info))
}

/// HTTP endpoint — used by the editor for live previews.
pub async fn fetch_link_preview(
    AuthUser(_user_id): AuthUser,
    State(db): State<Db>,
    Json(body): Json<LinkPreviewRequest>,
) -> Result<Json<LinkPreviewInfo>, ApiError> {
    let url = body.url.trim().to_string();
    if url.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "URL is required"));
    }

    match resolve_and_cache(&db, &url).await {
        Some((_, info)) => Ok(Json(info)),
        None => Err(err(StatusCode::BAD_GATEWAY, "Failed to fetch URL")),
    }
}
