"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PostEditor } from "@/components/post-editor";
import { PostFeed } from "@/components/post-feed";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";
import { getPosts, loadEmojis, Post } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { postFontsReady, preloadPostFonts } from "@/lib/font-preload";
import { consumeHomeLogoReset } from "@/lib/home-reset";
import { preloadImages } from "@/lib/image-loader";
import { pageImageUrls } from "@/lib/post-media";
import { scrollToTop } from "@/lib/scroll";
import { useTitle } from "@/lib/use-title";

interface CachedPage {
  posts: Post[];
  pages: number;
  total: number;
  post_pages?: Record<string, number>;
}

export interface InitialPage extends CachedPage {
  page: number;
}

interface HomeCache extends CachedPage {
  tag: string | undefined;
  page: number;
}

let homeCache: HomeCache | null = null;
let homeScrollY = 0;

// Cache each fetched page's data so turning to an already-loaded (or prefetched)
// page renders instantly from memory — no async fetch, no intermediate old-page
// frame, no layout shift. Invalidated whenever the timeline changes.
const pageCache = new Map<string, CachedPage>();
const pageRequests = new Map<string, Promise<void>>();
let pageCacheGeneration = 0;
const cacheKey = (tag: string | undefined, page: number) => `${tag ?? ""}:${page}`;

function clearPageCache() {
  pageCacheGeneration += 1;
  pageCache.clear();
  pageRequests.clear();
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
    const key = cacheKey(tag, p);
    if (p < 1 || p > pages || pageCache.has(key) || pageRequests.has(key)) continue;
    const generation = pageCacheGeneration;
    const request = getPosts(p, 20, tag)
      .then((r) => {
        if (generation !== pageCacheGeneration) return;
        pageCache.set(cacheKey(tag, r.page), {
          posts: r.posts,
          pages: r.pages,
          total: r.total,
          post_pages: r.post_pages,
        });
        preloadPostFonts(r.posts);
        preloadImages(pageImageUrls(r.posts));
      })
      .catch(() => {})
      .finally(() => {
        if (pageRequests.get(key) === request) pageRequests.delete(key);
      });
    pageRequests.set(key, request);
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
  const [postPages, setPostPages] = useState(seed?.post_pages ?? {});
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
    const cached = pageCache.get(cacheKey(tagParam, 1));
    setTotal(cached?.total ?? 0);
  }

  // Snapshot the pages available at an intentional feed transition. Background
  // prefetches must not re-derive this index: doing so replaced already-painted
  // echo cards and usernames when a neighbouring request completed.
  const pageOfPost = useMemo(() => {
    const at = new Map<string, number>(Object.entries(postPages));
    for (const [p, mountedPosts] of loadedPages) {
      // `loadedPages` may briefly retain another tag's pages during navigation.
      // Only index a page when it is the active feed's cached object.
      if (pageCache.get(cacheKey(activeTag, p))?.posts !== mountedPosts) continue;
      for (const post of mountedPosts) at.set(post.id, p);
    }
    return (id: string) => at.get(id);
  }, [activeTag, loadedPages, postPages]);

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
      setPostPages(cached.post_pages ?? {});
      setPage(p);
      setLoading(false);
      homeCache = {
        tag,
        posts: cached.posts,
        page: p,
        pages: cached.pages,
        total: cached.total,
        post_pages: cached.post_pages,
      };
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
      pageCache.set(cacheKey(tag, postsRes.page), {
        posts: postsRes.posts,
        pages: postsRes.pages,
        total: postsRes.total,
        post_pages: postsRes.post_pages,
      });
      setLoadedPages((prev) => withPage(prev, postsRes.page, postsRes.posts));
      setPages(postsRes.pages);
      setTotal(postsRes.total);
      setPostPages(postsRes.post_pages ?? {});
      setPage(postsRes.page);
      homeCache = {
        tag,
        posts: postsRes.posts,
        page: postsRes.page,
        pages: postsRes.pages,
        total: postsRes.total,
        post_pages: postsRes.post_pages,
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
    setPostPages({});
  }, []);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || snap || !seedServer) return;
    seededRef.current = true;
    pageCache.set(cacheKey(tagParam, seedServer.page), {
      posts: seedServer.posts,
      pages: seedServer.pages,
      total: seedServer.total,
      post_pages: seedServer.post_pages,
    });
    homeCache = { tag: tagParam, ...seedServer };
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
      pageCache.set(cacheKey(snapshot.tag, snapshot.page), {
        posts: snapshot.posts,
        pages: snapshot.pages,
        total: snapshot.total,
        post_pages: snapshot.post_pages,
      });
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
      const cached = pageCache.get(cacheKey(activeTag, n));
      setPostPages(cached?.post_pages ?? {});
      homeCache = {
        tag: activeTag,
        posts: loadedPages.get(n)!,
        page: n,
        pages,
        total,
        post_pages: cached?.post_pages,
      };
      prefetchNeighbors(n, activeTag, pages);
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
