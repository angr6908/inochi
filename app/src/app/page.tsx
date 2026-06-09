"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getPosts, Post } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { consumeHomeLogoReset } from "@/lib/home-reset";
import { cn } from "@/lib/utils";
import { PostCard } from "@/components/post-card";
import { PostEditor } from "@/components/post-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";
import { preloadHigh, preloadImages } from "@/lib/image-loader";

interface HomeCache {
  tag: string | undefined;
  posts: Post[];
  page: number;
  pages: number;
}

let homeCache: HomeCache | null = null;
let homeScrollY = 0;

// Jump to the top instantly (overriding the global `scroll-behavior: smooth` so
// the page doesn't visibly scroll up while the new page swaps in), then re-pin
// on the next frame after layout settles.
function scrollToTop() {
  if (typeof window === "undefined") return;
  const html = document.documentElement;
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    html.style.scrollBehavior = previous;
  });
}

// Cache each fetched page's data so turning to an already-loaded (or prefetched)
// page renders instantly from memory — no async fetch, no intermediate old-page
// frame, no layout shift. Invalidated whenever the timeline changes.
const pageCache = new Map<string, { posts: Post[]; pages: number }>();
const cacheKey = (tag: string | undefined, page: number) => `${tag ?? ""}:${page}`;

function clearPageCache() {
  pageCache.clear();
}

function firstMediaUrl(posts: Post[]): string | undefined {
  const first = posts[0];
  if (!first) return undefined;
  if (first.images[0]) return first.images[0].url;
  for (const lp of first.link_previews) {
    const thumb = lp.thumbnail ?? lp.image_url;
    if (thumb) return thumb;
  }
  return undefined;
}

function pageImageUrls(posts: Post[]): string[] {
  const urls: string[] = [];
  for (const post of posts) {
    for (const img of post.images) urls.push(img.url);
    for (const lp of post.link_previews) {
      const thumb = lp.thumbnail ?? lp.image_url;
      if (thumb) urls.push(thumb);
    }
  }
  return urls;
}

function prefetchNeighbors(page: number, tag: string | undefined, pages: number) {
  for (const p of [page + 1, page - 1]) {
    if (p < 1 || p > pages || pageCache.has(cacheKey(tag, p))) continue;
    getPosts(p, 20, tag)
      .then((r) => {
        pageCache.set(cacheKey(tag, r.page), { posts: r.posts, pages: r.pages });
      })
      .catch(() => {});
  }
}

function HomeContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const tagParam = searchParams.get("tag") || undefined;

  const [resetFromLogo] = useState(consumeHomeLogoReset);
  const [restore] = useState(() => !resetFromLogo && homeCache !== null && homeCache.tag === tagParam);
  const snap = restore ? homeCache! : null;

  const [posts, setPosts] = useState<Post[]>(() => snap?.posts ?? []);
  const [page, setPage] = useState(snap?.page ?? 1);
  const [pages, setPages] = useState(snap?.pages ?? 0);
  const [loading, setLoading] = useState(!restore);
  const [activeTag, setActiveTag] = useState<string | undefined>(tagParam);

  const [prevTag, setPrevTag] = useState(tagParam);
  if (tagParam !== prevTag) {
    setPrevTag(tagParam);
    setActiveTag(tagParam);
  }

  const reqRef = useRef(0);

  useEffect(() => {
    if (posts.length === 0) return;
    const run = () =>
      preloadImages(pageImageUrls(posts), () => {
        for (const p of [page + 1, page - 1]) {
          const neighbor = pageCache.get(cacheKey(activeTag, p));
          if (neighbor) preloadImages(pageImageUrls(neighbor.posts));
        }
      });
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run);
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [posts, page, activeTag]);

  const load = useCallback(async (p = 1, tag?: string) => {
    const myReq = ++reqRef.current;

    // Cache hit → render instantly, no loading state or async swap.
    const cached = pageCache.get(cacheKey(tag, p));
    if (cached) {
      const top = firstMediaUrl(cached.posts);
      if (top) preloadHigh(top);
      setPosts(cached.posts);
      setPages(cached.pages);
      setPage(p);
      setLoading(false);
      homeCache = { tag, posts: cached.posts, page: p, pages: cached.pages };
      prefetchNeighbors(p, tag, cached.pages);
      return;
    }
    setLoading(true);
    try {
      const postsRes = await getPosts(p, 20, tag);
      if (myReq !== reqRef.current) return;
      pageCache.set(cacheKey(tag, postsRes.page), { posts: postsRes.posts, pages: postsRes.pages });
      const top = firstMediaUrl(postsRes.posts);
      if (top) preloadHigh(top);
      setPosts(postsRes.posts);
      setPages(postsRes.pages);
      setPage(postsRes.page);
      homeCache = {
        tag,
        posts: postsRes.posts,
        page: postsRes.page,
        pages: postsRes.pages,
      };
      prefetchNeighbors(postsRes.page, tag, postsRes.pages);
    } catch {
      // ignore
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (resetFromLogo) {
      homeCache = null;
      homeScrollY = 0;
      clearPageCache();
      scrollToTop();
      return;
    }
    if (!restore || !homeCache) return;
    const snapshot = homeCache;
    window.scrollTo({ top: homeScrollY, behavior: "instant" });
    pageCache.set(cacheKey(snapshot.tag, snapshot.page), { posts: snapshot.posts, pages: snapshot.pages });
    prefetchNeighbors(snapshot.page, snapshot.tag, snapshot.pages);
  }, [resetFromLogo, restore]);

  useEffect(() => {
    const onScroll = () => {
      homeScrollY = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const loadedTag = useRef<{ v: string | undefined } | null>(restore ? { v: tagParam } : null);
  useEffect(() => {
    if (loadedTag.current && loadedTag.current.v === tagParam) return;
    loadedTag.current = { v: tagParam };
    load(1, tagParam);
  }, [tagParam, load]);

  // Clicking the logo while already on the timeline resets to page 1 (clearing
  // any active tag); scroll-to-top is handled by the nav bar.
  useEffect(() => {
    const reset = () => {
      setActiveTag(undefined);
      window.history.replaceState(null, "", "/");
      clearPageCache();
      load(1, undefined);
    };
    window.addEventListener("home:reset", reset);
    return () => window.removeEventListener("home:reset", reset);
  }, [load]);

  const changePage = (n: number) => {
    load(n, activeTag);
    scrollToTop();
  };

  return (
    <div className="space-y-4">
      {user && <PostEditor onPostCreated={() => { clearPageCache(); load(1, activeTag); }} />}

      {posts.length === 0 ? (
        loading ? (
          <PostListSkeleton />
        ) : (
          <p className="text-center text-muted-foreground py-8">No posts yet</p>
        )
      ) : (
        <>
          <div>
            {posts.map((post, i) => {
              // In the reverse-chronological timeline a reply sits directly
              // above the post it answers. When that parent is the very next
              // card, its embedded reference card is redundant — hide it and
              // merge the two cards into one connected thread.
              const next = posts[i + 1];
              const prev = posts[i - 1];
              const repliesToNext = !!(
                post.parent_post && next && post.parent_post.id === next.id
              );
              const continuesPrev = !!(
                prev?.parent_post && prev.parent_post.id === post.id
              );
              return (
                <PostCard
                  key={post.id}
                  post={post}
                  priority={i === 0}
                  hideParent={repliesToNext}
                  onUpdate={() => { clearPageCache(); load(page, activeTag); }}
                  className={cn(
                    repliesToNext ? "mb-0" : "mb-4",
                    i === posts.length - 1 && "mb-0",
                    repliesToNext && "rounded-b-none border-b-0",
                    continuesPrev && "rounded-t-none",
                  )}
                />
              );
            })}
          </div>
          <PostPagination page={page} pages={pages} onChange={changePage} />
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      <HomeContent />
    </Suspense>
  );
}
