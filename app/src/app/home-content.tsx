"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { getPosts, loadEmojis, Post } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { consumeHomeLogoReset } from "@/lib/home-reset";
import { useTitle } from "@/lib/use-title";
import { PostFeed } from "@/components/post-feed";
import { PostEditor } from "@/components/post-editor";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";
import { preloadImages } from "@/lib/image-loader";
import { pageImageUrls } from "@/lib/post-media";
import { preloadPostFonts, postFontsReady } from "@/lib/font-preload";
import { scrollToTop } from "@/lib/scroll";

export interface InitialPage {
  posts: Post[];
  page: number;
  pages: number;
}

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

const MAX_MOUNTED_PAGES = 8;

function withPage(prev: Map<number, Post[]>, p: number, posts: Post[]): Map<number, Post[]> {
  const m = new Map(prev);
  m.delete(p);
  m.set(p, posts);
  while (m.size > MAX_MOUNTED_PAGES) {
    const oldest = m.keys().next().value;
    if (oldest === undefined || oldest === p) break;
    m.delete(oldest);
  }
  return m;
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

export function HomeContent({ initial, initialTag }: { initial: InitialPage | null; initialTag?: string }) {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const tagParam = searchParams.get("tag") || undefined;

  const [resetFromLogo] = useState(consumeHomeLogoReset);
  const [restore] = useState(() => !resetFromLogo && homeCache !== null && homeCache.tag === tagParam);
  const snap = restore ? homeCache! : null;

  const seedServer = !snap && initial && initialTag === tagParam ? initial : null;
  const seed: HomeCache | null =
    snap ?? (seedServer ? { tag: tagParam, ...seedServer } : null);

  const [loadedPages, setLoadedPages] = useState<Map<number, Post[]>>(
    () => new Map(seed ? [[seed.page, seed.posts]] : []),
  );
  const [page, setPage] = useState(seed?.page ?? 1);
  const [pages, setPages] = useState(seed?.pages ?? 0);
  const [loading, setLoading] = useState(!seed);
  const posts = useMemo(() => loadedPages.get(page) ?? [], [loadedPages, page]);
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
      for (const p of [page + 1, page - 1]) {
        const neighbor = pageCache.get(cacheKey(activeTag, p));
        if (neighbor) {
          preloadPostFonts(neighbor.posts);
          preloadImages(pageImageUrls(neighbor.posts));
        }
      }
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
      await postFontsReady(cached.posts);
      if (myReq !== reqRef.current) return;
      setLoadedPages((prev) => withPage(prev, p, cached.posts));
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
      setLoadedPages((prev) => withPage(prev, postsRes.page, postsRes.posts));
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

  const resetPages = useCallback(() => {
    clearPageCache();
    setLoadedPages(new Map());
  }, []);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || snap || !seedServer) return;
    seededRef.current = true;
    pageCache.set(cacheKey(tagParam, seedServer.page), { posts: seedServer.posts, pages: seedServer.pages });
    homeCache = { tag: tagParam, posts: seedServer.posts, page: seedServer.page, pages: seedServer.pages };
    loadEmojis();
    prefetchNeighbors(seedServer.page, tagParam, seedServer.pages);
  }, [snap, seedServer, tagParam]);

  useLayoutEffect(() => {
    if (resetFromLogo) {
      homeCache = null;
      homeScrollY = 0;
      clearPageCache();
      scrollToTop();
      return;
    }
    if (restore && homeCache) {
      const snapshot = homeCache;
      window.scrollTo({ top: homeScrollY, behavior: "instant" });
      pageCache.set(cacheKey(snapshot.tag, snapshot.page), { posts: snapshot.posts, pages: snapshot.pages });
      prefetchNeighbors(snapshot.page, snapshot.tag, snapshot.pages);
      return;
    }
    scrollToTop();
  }, [resetFromLogo, restore]);

  useEffect(() => {
    const onScroll = () => {
      homeScrollY = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const seeded = useRef(seed !== null);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    load(1, tagParam);
  }, [tagParam, load]);

  // Clicking the logo while already on the timeline resets to page 1 (clearing
  // any active tag); scroll-to-top is handled by the nav bar.
  useEffect(() => {
    const reset = () => {
      setActiveTag(undefined);
      window.history.replaceState(null, "", "/");
      load(1, undefined);
    };
    window.addEventListener("home:reset", reset);
    return () => window.removeEventListener("home:reset", reset);
  }, [load]);

  const changePage = (n: number) => {
    if (loadedPages.has(n)) {
      setLoadedPages((prev) => withPage(prev, n, prev.get(n)!));
      setPage(n);
      homeCache = { tag: activeTag, posts: loadedPages.get(n)!, page: n, pages };
      prefetchNeighbors(n, activeTag, pages);
    } else {
      load(n, activeTag);
    }
    scrollToTop();
  };

  const reloadCurrent = () => { resetPages(); load(page, activeTag); };

  return (
    <div className="space-y-4">
      {user && <PostEditor onPostCreated={() => { resetPages(); load(1, activeTag); }} />}

      {posts.length === 0 ? (
        loading ? (
          <PostListSkeleton />
        ) : (
          <p className="text-center text-muted-foreground py-8">No posts yet</p>
        )
      ) : (
        <>
          {[...loadedPages].map(([pn, pp]) => (
            <div key={pn} hidden={pn !== page}>
              <PostFeed
                posts={pp}
                dedupeReferences={!!activeTag}
                onUpdate={reloadCurrent}
              />
            </div>
          ))}
          <PostPagination page={page} pages={pages} onChange={changePage} />
        </>
      )}
    </div>
  );
}
