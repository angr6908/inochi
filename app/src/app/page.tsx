"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getPosts, loadEmojis, Post } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { consumeHomeLogoReset } from "@/lib/home-reset";
import { useTitle } from "@/lib/use-title";
import { PostFeed } from "@/components/post-feed";
import { PostEditor } from "@/components/post-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";
import { preloadHigh, preloadImages } from "@/lib/image-loader";
import { firstPostMediaUrls, pageImageUrls } from "@/lib/post-media";
import { preloadPostFonts, postFontsReady } from "@/lib/font-preload";
import { scrollToTop } from "@/lib/scroll";

interface HomeCache {
  tag: string | undefined;
  posts: Post[];
  page: number;
  pages: number;
}

let homeCache: HomeCache | null = null;
let homeScrollY = 0;

// Cache each fetched page's data so turning to an already-loaded (or prefetched)
// page renders instantly from memory — no async fetch, no intermediate old-page
// frame, no layout shift. Invalidated whenever the timeline changes.
const pageCache = new Map<string, { posts: Post[]; pages: number }>();
const cacheKey = (tag: string | undefined, page: number) => `${tag ?? ""}:${page}`;

function clearPageCache() {
  pageCache.clear();
}

function prefetchNeighbors(page: number, tag: string | undefined, pages: number) {
  for (const p of [page + 1, page - 1]) {
    if (p < 1 || p > pages || pageCache.has(cacheKey(tag, p))) continue;
    getPosts(p, 20, tag)
      .then((r) => {
        pageCache.set(cacheKey(tag, r.page), { posts: r.posts, pages: r.pages });
        preloadPostFonts(r.posts);
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
  useTitle(activeTag ? `#${activeTag}` : undefined);

  const [prevTag, setPrevTag] = useState(tagParam);
  if (tagParam !== prevTag) {
    setPrevTag(tagParam);
    setActiveTag(tagParam);
  }

  const reqRef = useRef(0);

  useEffect(() => {
    if (posts.length === 0) return;
    const run = () => {
      preloadPostFonts(posts);
      preloadImages(pageImageUrls(posts), () => {
        for (const p of [page + 1, page - 1]) {
          const neighbor = pageCache.get(cacheKey(activeTag, p));
          if (neighbor) {
            preloadPostFonts(neighbor.posts);
            preloadImages(pageImageUrls(neighbor.posts));
          }
        }
      });
    };
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
      preloadHigh(...firstPostMediaUrls(cached.posts));
      await postFontsReady(cached.posts);
      if (myReq !== reqRef.current) return;
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
      // Fetch the emoji list alongside the posts so its shortcode→url map is
      // ready at first paint — otherwise emojis only appear on a later re-render
      // (after PostContent mounts and fetches them), well after the images.
      const [postsRes] = await Promise.all([getPosts(p, 20, tag), loadEmojis()]);
      if (myReq !== reqRef.current) return;
      pageCache.set(cacheKey(tag, postsRes.page), { posts: postsRes.posts, pages: postsRes.pages });
      preloadHigh(...firstPostMediaUrls(postsRes.posts));
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
    const prev = loadedTag.current;
    if (prev && prev.v === tagParam) return;
    loadedTag.current = { v: tagParam };
    load(1, tagParam);
    // Clicking a #hashtag swaps the tag in place (same `/` route, no remount),
    // so the scroll position carries over from the previous feed — pin to the
    // top of the new one. Skip the initial mount (`prev === null`), where the
    // route navigation (or cache restore) already settles the scroll.
    if (prev) scrollToTop();
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
          <PostFeed
            posts={posts}
            dedupeReferences={!!activeTag}
            onUpdate={() => { clearPageCache(); load(page, activeTag); }}
          />
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
