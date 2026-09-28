"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { searchPosts, Post } from "@/lib/api";
import { PostFeed } from "@/components/post-feed";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";
import { prefetchImages, refreshPrefetch } from "@/lib/image-loader";
import { pageImageUrls } from "@/lib/post-media";
import { preloadPostFonts } from "@/lib/font-preload";
import { useTimelineTracking } from "@/lib/use-timeline-tracking";
import { useTitle } from "@/lib/use-title";
import { scrollToTop } from "@/lib/scroll";

export interface InitialSearch {
  posts: Post[];
  page: number;
  pages: number;
  total: number;
  matches?: number;
  post_pages?: Record<string, number>;
}

interface CachedSearch {
  posts: Post[];
  pages: number;
  matches: number;
  post_pages?: Record<string, number>;
}

const pageCache = new Map<string, CachedSearch>();
const cacheKey = (q: string, page: number) => `${q}:${page}`;

function clearPageCache() {
  pageCache.clear();
}

function prefetchNeighbors(q: string, page: number, pages: number) {
  for (const p of [page + 1, page - 1]) {
    if (p < 1 || p > pages || pageCache.has(cacheKey(q, p))) continue;
    searchPosts(q, p)
      .then((r) => {
        pageCache.set(cacheKey(q, r.page), { posts: r.posts, pages: r.pages, matches: r.matches ?? r.total, post_pages: r.post_pages });
        preloadPostFonts(r.posts);
        refreshPrefetch();
      })
      .catch(() => {});
  }
}

export function SearchContent({ initialQ, initial }: { initialQ: string; initial: InitialSearch | null }) {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  useTitle(q ? `Search: ${q}` : "Search");

  const seed = initial && initialQ === q ? initial : null;
  const [posts, setPosts] = useState<Post[]>(seed?.posts ?? []);
  const [page, setPage] = useState(seed?.page ?? 1);
  const [pages, setPages] = useState(seed?.pages ?? 0);
  const [matches, setMatches] = useState(seed ? seed.matches ?? seed.total : 0);
  const [postPages, setPostPages] = useState(seed?.post_pages ?? {});
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<{ page: number; id: string } | null>(null);
  const pageOfPost = useCallback((id: string) => postPages[id], [postPages]);
  useTimelineTracking(posts);

  const reqRef = useRef(0);

  const search = useCallback(async (searchQuery: string, p = 1) => {
    const query = searchQuery.trim();
    if (!query) return;
    const myReq = ++reqRef.current;

    const cached = pageCache.get(cacheKey(query, p));
    if (cached) {
      setPosts(cached.posts);
      setPage(p);
      setPages(cached.pages);
      setMatches(cached.matches);
      setPostPages(cached.post_pages ?? {});
      setLoading(false);
      prefetchNeighbors(query, p, cached.pages);
      return;
    }
    setLoading(true);
    try {
      const res = await searchPosts(query, p);
      if (myReq !== reqRef.current) return;
      pageCache.set(cacheKey(query, res.page), { posts: res.posts, pages: res.pages, matches: res.matches ?? res.total, post_pages: res.post_pages });
      setPosts(res.posts);
      setPage(res.page);
      setPages(res.pages);
      setMatches(res.matches ?? res.total);
      setPostPages(res.post_pages ?? {});
      prefetchNeighbors(query, res.page, res.pages);
    } catch {
      // ignore
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, []);

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !seed) return;
    seededRef.current = true;
    const query = q.trim();
    pageCache.set(cacheKey(query, seed.page), { posts: seed.posts, pages: seed.pages, matches: seed.matches ?? seed.total, post_pages: seed.post_pages });
    prefetchNeighbors(query, seed.page, seed.pages);
  }, [seed, q]);

  const searched = useRef<string | null>(seed ? q : null);
  useEffect(() => {
    if (searched.current === q) return;
    searched.current = q;
    search(q);
  }, [q, search]);

  useEffect(() => {
    if (posts.length === 0) return;
    prefetchImages(() => {
      const next = pageCache.get(cacheKey(q.trim(), page + 1));
      return next ? pageImageUrls(next.posts, next.post_pages) : [];
    });
  }, [posts, q, page]);

  useEffect(() => {
    if (posts.length === 0) return;
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

  const changePage = (n: number, focusId?: string) => {
    search(q, n);
    setFocus(focusId ? { page: n, id: focusId } : null);
    if (!focusId) scrollToTop();
  };

  const reloadCurrent = () => { clearPageCache(); setFocus(null); search(q, page); };

  return (
    <div className="space-y-4">
      {loading ? (
        <PostListSkeleton />
      ) : posts.length === 0 && q ? (
        <p className="text-center text-muted-foreground py-8">No results for &ldquo;{q}&rdquo;</p>
      ) : (
        <>
          {matches > 0 && (
            <p className="text-sm text-muted-foreground">{matches} result{matches !== 1 ? "s" : ""}</p>
          )}
          <PostFeed
            timeline
            posts={posts}
            onUpdate={reloadCurrent}
            pageOfPost={pageOfPost}
            onJumpToPage={changePage}
            focus={focus?.page === page ? focus : null}
          />
          <PostPagination page={page} pages={pages} onChange={changePage} />
        </>
      )}
    </div>
  );
}
