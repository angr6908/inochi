use rusqlite::Connection;
use std::sync::{Arc, Mutex, MutexGuard};

pub type Db = Arc<Mutex<Connection>>;

// A panic under the lock poisons the Mutex; the Connection survives it, so
// recover the guard rather than letting every later lock panic too.
pub trait DbExt {
    fn conn(&self) -> MutexGuard<'_, Connection>;
}

impl DbExt for Db {
    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn query_rows<T, P, F>(conn: &Connection, sql: &str, params: P, f: F) -> Vec<T>
where
    P: rusqlite::Params,
    F: FnMut(&rusqlite::Row) -> rusqlite::Result<T>,
{
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(params, f) else {
        return Vec::new();
    };
    rows.filter_map(|r| r.ok()).collect()
}

pub fn init_db() -> Db {
    let conn = Connection::open("inochi.db").expect("Failed to open database");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("Failed to set pragmas");
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            parent_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS post_images (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            width INTEGER,
            height INTEGER
        );
        CREATE TABLE IF NOT EXISTS post_tags (
            post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (post_id, tag)
        );
        CREATE TABLE IF NOT EXISTS link_previews (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT,
            description TEXT,
            image_url TEXT,
            site_name TEXT,
            author TEXT,
            fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
            thumbnail TEXT
        );
        CREATE TABLE IF NOT EXISTS link_preview_images (
            id TEXT PRIMARY KEY,
            link_preview_id TEXT NOT NULL REFERENCES link_previews(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            image_url TEXT,
            thumbnail TEXT
        );
        CREATE TABLE IF NOT EXISTS post_links (
            post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
            link_preview_id TEXT NOT NULL REFERENCES link_previews(id),
            PRIMARY KEY (post_id, link_preview_id)
        );
        CREATE TABLE IF NOT EXISTS custom_emojis (
            id TEXT PRIMARY KEY,
            shortcode TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            uploaded_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )
    .expect("Failed to create tables");

    Arc::new(Mutex::new(conn))
}
