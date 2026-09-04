"use client";

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useCallback } from "react";
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
  total: number;
}

interface HomeCache {
  tag: string | undefined;
  posts: Post[];
  page: number;
  pages: number;
  total: number;
}

let homeCache: HomeCache | null = null;
let homeScrollY = 0;

// Cache each fetched page's data so turning to an already-loaded (or prefetched)
// page renders instantly from memory — no async fetch, no intermediate old-page
// frame, no layout shift. Invalidated whenever the timeline changes.
const pageCache = new Map<string, { posts: Post[]; pages: number; total: number }>();
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

function prefetchNeighbors(
  page: number,
  tag: string | undefined,
  pages: number,
  onCached?: () => void,
) {
  for (const p of [page + 1, page - 1]) {
    if (p < 1 || p > pages || pageCache.has(cacheKey(tag, p))) continue;
    getPosts(p, 20, tag)
      .then((r) => {
        pageCache.set(cacheKey(tag, r.page), { posts: r.posts, pages: r.pages, total: r.total });
        preloadPostFonts(r.posts);
        preloadImages(pageImageUrls(r.posts));
        onCached?.();
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
  const [total, setTotal] = useState(seed?.total ?? 0);
  const [loading, setLoading] = useState(!seed);
  const posts = useMemo(() => loadedPages.get(page) ?? [], [loadedPages, page]);
  const [activeTag, setActiveTag] = useState<string | undefined>(tagParam);
  useTitle(activeTag ? `#${activeTag}` : undefined);

  const [prevTag, setPrevTag] = useState(tagParam);
  if (tagParam !== prevTag) {
    setPrevTag(tagParam);
    setActiveTag(tagParam);
    // The count belongs to the tag we are leaving. activeTag flips here, a
    // render before the new feed lands, so without this the header pairs the
    // new tag with the old tag's total for a beat. Take the cached count when
    // this tag's first page is already in hand, so revisits stay instant.
    setTotal(pageCache.get(cacheKey(tagParam, 1))?.total ?? 0);
  }

  // Pages land in `pageCache` outside of React (the background prefetch of the
  // neighbouring pages), which on its own would never re-render; bumping this
  // re-derives `pageOfPost` as they arrive.
  const [cacheVersion, bumpCache] = useReducer((n: number) => n + 1, 0);

  // Where every post the feed has in hand lives, so an echo whose original sits
  // on another page can link to it instead of quoting it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cacheVersion` re-derives the index as pages land
  const pageOfPost = useMemo(() => {
    const at = new Map<string, number>();
    for (let p = 1; p <= pages; p++)
      for (const post of pageCache.get(cacheKey(activeTag, p))?.posts ?? []) at.set(post.id, p);
    return (id: string) => at.get(id);
  }, [activeTag, pages, cacheVersion]);

  // The post to scroll to and highlight after turning to another page (set when
  // an echo's reference points off this page). A fresh object per jump, so the
  // same target twice in a row still moves.
  const [focus, setFocus] = useState<{ page: number; id: string } | null>(null);

  const reqRef = useRef(0);

  useEffect(() => {
    if (posts.length === 0) return;
    // Neighbor media is preloaded in prefetchNeighbors when its data lands; here
    // we only warm the current page's fonts.
    const run = () => preloadPostFonts(posts);
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
  }, [posts]);

  const load = useCallback(async (p = 1, tag?: string) => {
    const myReq = ++reqRef.current;

    // Cache hit → render instantly, no loading state or async swap.
    const cached = pageCache.get(cacheKey(tag, p));
    if (cached) {
      await postFontsReady(cached.posts);
      if (myReq !== reqRef.current) return;
      setLoadedPages((prev) => withPage(prev, p, cached.posts));
      setPages(cached.pages);
      setTotal(cached.total);
      setPage(p);
      setLoading(false);
      homeCache = { tag, posts: cached.posts, page: p, pages: cached.pages, total: cached.total };
      prefetchNeighbors(p, tag, cached.pages, bumpCache);
      return;
    }
    setLoading(true);
    try {
      // Fetch the emoji list alongside the posts so its shortcode→url map is
      // ready at first paint — otherwise emojis only appear on a later re-render
      // (after PostContent mounts and fetches them), well after the images.
      const [postsRes] = await Promise.all([getPosts(p, 20, tag), loadEmojis()]);
      if (myReq !== reqRef.current) return;
      pageCache.set(cacheKey(tag, postsRes.page), { posts: postsRes.posts, pages: postsRes.pages, total: postsRes.total });
      bumpCache();
      setLoadedPages((prev) => withPage(prev, postsRes.page, postsRes.posts));
      setPages(postsRes.pages);
      setTotal(postsRes.total);
      setPage(postsRes.page);
      homeCache = {
        tag,
        posts: postsRes.posts,
        page: postsRes.page,
        pages: postsRes.pages,
        total: postsRes.total,
      };
      prefetchNeighbors(postsRes.page, tag, postsRes.pages, bumpCache);
    } catch {
      // ignore
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, []);

  const resetPages = useCallback(() => {
    clearPageCache();
    bumpCache();
    setLoadedPages(new Map());
  }, []);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || snap || !seedServer) return;
    seededRef.current = true;
    pageCache.set(cacheKey(tagParam, seedServer.page), { posts: seedServer.posts, pages: seedServer.pages, total: seedServer.total });
    homeCache = { tag: tagParam, posts: seedServer.posts, page: seedServer.page, pages: seedServer.pages, total: seedServer.total };
    loadEmojis();
    prefetchNeighbors(seedServer.page, tagParam, seedServer.pages, bumpCache);
    bumpCache();
  }, [snap, seedServer, tagParam]);

  useLayoutEffect(() => {
    if (resetFromLogo) {
      homeCache = null;
      homeScrollY = 0;
      clearPageCache();
      bumpCache();
      scrollToTop();
      return;
    }
    if (restore && homeCache) {
      const snapshot = homeCache;
      window.scrollTo({ top: homeScrollY, behavior: "instant" });
      pageCache.set(cacheKey(snapshot.tag, snapshot.page), { posts: snapshot.posts, pages: snapshot.pages, total: snapshot.total });
      bumpCache();
      prefetchNeighbors(snapshot.page, snapshot.tag, snapshot.pages, bumpCache);
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

  // The tag the mounted content represents (`null` = nothing loaded yet). Reload
  // whenever the URL's tag diverges from it — e.g. when Next's router cache
  // serves a stale page payload so `key` doesn't change and this instance isn't
  // remounted, leaving the feed on the previous tag while only the URL updated.
  const loadedTag = useRef<string | null | undefined>(seed ? tagParam : null);
  useEffect(() => {
    if (loadedTag.current === tagParam) return;
    loadedTag.current = tagParam;
    load(1, tagParam);
  }, [tagParam, load]);

  // Clicking the logo while already on the timeline resets to page 1 (clearing
  // any active tag); scroll-to-top is handled by the nav bar.
  useEffect(() => {
    const reset = () => {
      setActiveTag(undefined);
      loadedTag.current = undefined;
      window.history.replaceState(null, "", "/");
      load(1, undefined);
    };
    window.addEventListener("home:reset", reset);
    return () => window.removeEventListener("home:reset", reset);
  }, [load]);

  // `focusId` turns the page to land on a specific post (an echo's original on
  // another page) rather than at the top.
  const changePage = (n: number, focusId?: string) => {
    if (loadedPages.has(n)) {
      setLoadedPages((prev) => withPage(prev, n, prev.get(n)!));
      setPage(n);
      homeCache = { tag: activeTag, posts: loadedPages.get(n)!, page: n, pages, total };
      prefetchNeighbors(n, activeTag, pages, bumpCache);
    } else {
      load(n, activeTag);
    }
    setFocus(focusId ? { page: n, id: focusId } : null);
    if (!focusId) scrollToTop();
  };

  const reloadCurrent = () => { resetPages(); load(page, activeTag); };

  return (
    <div className="space-y-4">
      {user && <PostEditor onPostCreated={() => { resetPages(); load(1, activeTag); }} />}

      {/* Gated on the count as well as the tag so the line never paints in two
          stages. A direct /?tag= load has the total in the server seed and
          renders complete in the first paint; on a client-side tag navigation
          useSearchParams() flips the tag a render before the new feed lands, so
          showing the tag alone would pair it with the previous feed's count. */}
      {activeTag && total > 0 && (
        <p className="text-sm text-muted-foreground">
          #{activeTag} · {total} result{total !== 1 ? "s" : ""}
        </p>
      )}

      {posts.length === 0 ? (
        loading ? (
          <PostListSkeleton />
        ) : (
          <p className="text-center text-muted-foreground py-8">
            {activeTag ? <>No results for #{activeTag}</> : "No posts yet"}
          </p>
        )
      ) : (
        <>
          {[...loadedPages].map(([pn, pp]) => (
            <div key={pn} hidden={pn !== page}>
              <PostFeed
                posts={pp}
                onUpdate={reloadCurrent}
                pageOfPost={pageOfPost}
                onJumpToPage={changePage}
                focus={focus?.page === pn ? focus : null}
              />
            </div>
          ))}
          <PostPagination page={page} pages={pages} onChange={changePage} />
        </>
      )}
    </div>
  );
}
