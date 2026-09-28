import { Post, cachedEmojis } from "@/lib/api";
import { previewImageUrls } from "@/lib/link-preview";

const EMOJI_TOKEN = /:([a-zA-Z0-9_]+):/g;

type QuotedPost = NonNullable<Post["parent_post"]>;

export function quoteChain(post: Post): (Post | QuotedPost)[] {
  if (post.ancestors && post.ancestors.length > 0) return post.ancestors;
  return post.parent_post ? [post.parent_post] : [];
}

function postMediaUrls(post: Post | QuotedPost, emojiUrl: Map<string, string>): string[] {
  const urls: string[] = [];
  if (emojiUrl.size) {
    let m: RegExpExecArray | null;
    EMOJI_TOKEN.lastIndex = 0;
    while ((m = EMOJI_TOKEN.exec(post.content)) !== null) {
      const u = emojiUrl.get(m[1]);
      if (u) urls.push(u);
    }
  }
  for (const img of post.images) urls.push(img.url);
  for (const lp of post.link_previews) urls.push(...previewImageUrls(lp));
  return urls;
}

export function pageImageUrls(posts: Post[], postPages?: Record<string, number>): string[] {
  const emojiUrl = new Map((cachedEmojis() ?? []).map((e) => [e.shortcode, e.url]));
  const onPage = new Set(posts.map((p) => p.id));
  const urls: string[] = [];
  for (const post of posts) {
    urls.push(...postMediaUrls(post, emojiUrl));
    const parent = post.parent_post;
    if (parent && (onPage.has(parent.id) || postPages?.[parent.id] !== undefined)) continue;
    for (const quoted of quoteChain(post)) urls.push(...postMediaUrls(quoted, emojiUrl));
  }
  return urls;
}

export const FIRST_SCREEN_POSTS = 6;

export function hasShownImage(post: Post): boolean {
  return (
    post.images.length > 0 ||
    post.link_previews.some((lp) => previewImageUrls(lp).length > 0)
  );
}
