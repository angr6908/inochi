export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  username: string;
  parent_post_id: string | null;
  root_post_id: string;
  parent_post: { id: string; username: string; content: string; created_at: string; images: { id: string; url: string; width: number | null; height: number | null }[]; link_previews: LinkPreview[] } | null;
  /** The thread above this post, root-first up to its parent; empty for a root post. */
  ancestors?: Post[];
  content: string;
  images: { id: string; url: string; width: number | null; height: number | null }[];
  link_previews: LinkPreview[];
  tags: string[];
  followup_count: number;
  created_at: string;
  updated_at: string;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  /** Locally-served copy of the thumbnail (/uploads/previews/...). */
  thumbnail: string | null;
  site_name: string | null;
  author: string | null;
  /** Pixel size of the locally-served thumbnail, used to reserve the card's
   *  image box at the real aspect ratio before it loads. Null when unknown. */
  image_width?: number | null;
  image_height?: number | null;
  /** Every image in order when the preview has more than one (e.g. a tweet
   *  with several photos). Empty/absent for single-image previews. */
  images?: PreviewImage[];
}

export interface PreviewImage {
  image_url: string | null;
  thumbnail: string | null;
  image_width?: number | null;
  image_height?: number | null;
}

export interface Emoji {
  id: string;
  shortcode: string;
  url: string;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

// Auth
export const signUp = (username: string, password: string) =>
  request<{ token: string; user: User }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const signIn = (username: string, password: string) =>
  request<{ token: string; user: User }>("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

// Users
export const getMe = () => request<User>("/api/users/me");

export const updatePassword = (current_password: string, new_password: string) =>
  request<{ message: string }>("/api/users/me/password", {
    method: "PUT",
    body: JSON.stringify({ current_password, new_password }),
  });

export const updateUsername = (new_username: string) =>
  request<{ user: User }>("/api/users/me/username", {
    method: "PUT",
    body: JSON.stringify({ new_username }),
  });

export const deleteAccount = (password: string) =>
  request<{ message: string }>("/api/users/me", {
    method: "DELETE",
    body: JSON.stringify({ password }),
  });

// Posts
export const getPosts = (page = 1, limit = 20, tag?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (tag) params.set("tag", tag);
  return request<{ posts: Post[]; total: number; page: number; pages: number }>(
    `/api/posts?${params}`
  );
};

export const getPost = (id: string) =>
  request<{ post: Post; followups: Post[] }>(`/api/posts/${id}`);

export const createPost = (formData: FormData) =>
  request<{ post: Post }>("/api/posts", { method: "POST", body: formData });

// Multipart, mirroring `createPost`: carries `content`, optional `images` files,
// and an `image_order` JSON array describing the final image list (existing
// image ids and `new:<n>` tokens for uploads). The echo link is controlled by
// the `parent_post_id` field: omit it to leave the link as is, send an empty
// string to unlink into an independent post, or a post id to echo that post.
export const updatePost = (id: string, formData: FormData) =>
  request<{ post: Post }>(`/api/posts/${id}`, { method: "PUT", body: formData });

export const deletePost = (id: string) =>
  request<{ message: string }>(`/api/posts/${id}`, { method: "DELETE" });

// Emojis
export const getEmojis = () => request<{ emojis: Emoji[] }>("/api/emojis");

// Custom emojis change rarely, so the first fetch is cached process-wide and
// shared by every caller (post rendering, the emoji picker). The last-known list
// is also persisted to localStorage so a hard refresh can render emoji images on
// the first paint (from cache) instead of flashing their `:shortcode:` text.
const EMOJI_STORE_KEY = "inochi:emojis";
let emojiCache: Emoji[] | null = null;
let emojiPromise: Promise<Emoji[]> | null = null;
let storedEmojis: Emoji[] | null | undefined;

function readStoredEmojis(): Emoji[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(EMOJI_STORE_KEY);
    return raw ? (JSON.parse(raw) as Emoji[]) : null;
  } catch {
    return null;
  }
}

function persistEmojis(emojis: Emoji[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EMOJI_STORE_KEY, JSON.stringify(emojis));
  } catch {
    // private mode / quota — fine to skip the cache write
  }
}

/** Cached, de-duplicated fetch of the custom emoji list (never rejects). */
export function loadEmojis(): Promise<Emoji[]> {
  if (emojiCache) return Promise.resolve(emojiCache);
  if (!emojiPromise) {
    const fetchP: Promise<Emoji[]> = getEmojis()
      .then((r) => {
        // If refreshEmojis replaced the cache while this was in flight, its
        // list is newer than this response — don't clobber it.
        if (emojiPromise === fetchP) {
          emojiCache = r.emojis;
          persistEmojis(r.emojis);
        }
        return emojiCache ?? r.emojis;
      })
      .catch(() => {
        if (emojiPromise === fetchP) emojiPromise = null;
        return emojiCache ?? readStoredEmojis() ?? [];
      });
    emojiPromise = fetchP;
  }
  return emojiPromise;
}

/**
 * Authoritative re-fetch after an emoji mutation (upload/delete): replaces
 * every cache layer so post cards and the picker resolve shortcodes against
 * the current list instead of the one captured at first load.
 */
export async function refreshEmojis(): Promise<Emoji[]> {
  const r = await getEmojis();
  // Detach any in-flight loadEmojis fetch so a response that raced the
  // mutation can't overwrite this newer list (see the guard in loadEmojis).
  emojiPromise = null;
  emojiCache = r.emojis;
  storedEmojis = r.emojis;
  persistEmojis(r.emojis);
  return r.emojis;
}

/**
 * Best already-available emoji list for an instant first render: the fetched
 * list, else the persisted one, else null before anything is known.
 */
export const cachedEmojis = (): Emoji[] | null => {
  if (emojiCache) return emojiCache;
  if (storedEmojis === undefined) storedEmojis = readStoredEmojis();
  return storedEmojis;
};

/**
 * Whether the authoritative list has been fetched from the network. The stored
 * (localStorage) list is good for an instant first paint but may be stale, so a
 * shortcode missing from it isn't necessarily literal text until this is true.
 */
export const emojisFetched = (): boolean => emojiCache != null;

let seededOnClient = false;

export function seedEmojis(emojis: Emoji[]): void {
  // On the server this runs per request inside the long-lived Next process and
  // must always replace the cache: a keep-first policy froze the list captured
  // on the first request after boot, so SSR kept resolving shortcodes to
  // deleted emojis' URLs (and hydration doesn't patch attribute mismatches, so
  // the stale <img src> stuck client-side too). The list comes from the
  // layout's per-request no-store fetch, so replacing never goes backwards.
  //
  // On the client, seed exactly once (at hydration, with the same list the
  // server rendered with): a later re-render of <SeedEmojis> would replay the
  // page-load-time props and must not clobber a newer refreshEmojis result.
  if (typeof window !== "undefined") {
    if (seededOnClient) return;
    seededOnClient = true;
  }
  emojiCache = emojis;
  persistEmojis(emojis);
}

export const uploadEmoji = (formData: FormData) =>
  request<{ emoji: Emoji }>("/api/emojis", { method: "POST", body: formData });

export const deleteEmoji = (id: string) =>
  request<{ message: string }>(`/api/emojis/${id}`, { method: "DELETE" });

// Search
export const searchPosts = (q: string, page = 1, limit = 20) =>
  request<{ posts: Post[]; total: number; page: number; pages: number; matches?: number }>(
    `/api/search?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`
  );

// Link Preview
export const fetchLinkPreview = (url: string) =>
  request<LinkPreview>("/api/link-preview", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
