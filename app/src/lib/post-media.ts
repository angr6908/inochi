import { Post, cachedEmojis } from "@/lib/api";

const EMOJI_TOKEN = /:([a-zA-Z0-9_]+):/g;

function postMediaUrls(post: Post, emojiUrl: Map<string, string>): string[] {
  const urls: string[] = [];
  for (const img of post.images) urls.push(img.url);
  for (const lp of post.link_previews) {
    const thumb = lp.thumbnail ?? lp.image_url;
    if (thumb) urls.push(thumb);
  }
  if (emojiUrl.size) {
    let m: RegExpExecArray | null;
    EMOJI_TOKEN.lastIndex = 0;
    while ((m = EMOJI_TOKEN.exec(post.content)) !== null) {
      const u = emojiUrl.get(m[1]);
      if (u) urls.push(u);
    }
  }
  return urls;
}

export function firstPostMediaUrls(posts: Post[]): string[] {
  const emojiUrl = new Map((cachedEmojis() ?? []).map((e) => [e.shortcode, e.url]));
  for (const post of posts) {
    const urls = postMediaUrls(post, emojiUrl);
    if (urls.length) return urls;
  }
  return [];
}

export function pageImageUrls(posts: Post[]): string[] {
  const emojiUrl = new Map((cachedEmojis() ?? []).map((e) => [e.shortcode, e.url]));
  const urls: string[] = [];
  for (const post of posts) urls.push(...postMediaUrls(post, emojiUrl));
  return urls;
}
