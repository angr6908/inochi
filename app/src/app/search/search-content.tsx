"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { searchPosts, Post } from "@/lib/api";
import { PostFeed } from "@/components/post-feed";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";
import { preloadHigh, preloadImages } from "@/lib/image-loader";
import { firstPostMediaUrls, pageImageUrls } from "@/lib/post-media";
import { preloadPostFonts } from "@/lib/font-preload";
import { useTitle } from "@/lib/use-title";
import { scrollToTop } from "@/lib/scroll";

export interface InitialSearch {
  posts: Post[];
  page: number;
  pages: number;
  total: number;
  matches?: number;
}

const pageCache = new Map<string, { posts: Post[]; pages: number; matches: number }>();
const cacheKey = (q: string, page: number) => `${q}:${page}`;

function clearPageCache() {
  pageCache.clear();
}

function prefetchNeighbors(q: string, page: number, pages: number) {
  for (const p of [page + 1, page - 1]) {
    if (p < 1 || p > pages || pageCache.has(cacheKey(q, p))) continue;
    searchPosts(q, p)
      .then((r) => {
        pageCache.set(cacheKey(q, r.page), { posts: r.posts, pages: r.pages, matches: r.matches ?? r.total });
        preloadPostFonts(r.posts);
        preloadImages(pageImageUrls(r.posts));
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
  const [loading, setLoading] = useState(false);

  const reqRef = useRef(0);

  const search = useCallback(async (searchQuery: string, p = 1) => {
    const query = searchQuery.trim();
    if (!query) return;
    const myReq = ++reqRef.current;

    const cached = pageCache.get(cacheKey(query, p));
    if (cached) {
      preloadHigh(...firstPostMediaUrls(cached.posts));
      setPosts(cached.posts);
      setPage(p);
      setPages(cached.pages);
      setMatches(cached.matches);
      setLoading(false);
      prefetchNeighbors(query, p, cached.pages);
      return;
    }
    setLoading(true);
    try {
      const res = await searchPosts(query, p);
      if (myReq !== reqRef.current) return;
      pageCache.set(cacheKey(query, res.page), { posts: res.posts, pages: res.pages, matches: res.matches ?? res.total });
      preloadHigh(...firstPostMediaUrls(res.posts));
      setPosts(res.posts);
      setPage(res.page);
      setPages(res.pages);
      setMatches(res.matches ?? res.total);
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
    pageCache.set(cacheKey(q, seed.page), { posts: seed.posts, pages: seed.pages, matches: seed.matches ?? seed.total });
    preloadHigh(...firstPostMediaUrls(seed.posts));
    prefetchNeighbors(q, seed.page, seed.pages);
  }, [seed, q]);

  const searched = useRef<string | null>(seed ? q : null);
  useEffect(() => {
    if (searched.current === q) return;
    searched.current = q;
    search(q);
  }, [q, search]);

  useEffect(() => {
    if (posts.length === 0) return;
    // Neighbor media is preloaded in prefetchNeighbors when its data lands; here
    // we only warm the current page's fonts and images.
    const run = () => {
      preloadPostFonts(posts);
      preloadImages(pageImageUrls(posts));
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
  }, [posts]);

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
          <PostFeed posts={posts} onUpdate={() => { clearPageCache(); search(q, page); }} />
          <PostPagination page={page} pages={pages} onChange={(p) => { search(q, p); scrollToTop(); }} />
        </>
      )}
    </div>
  );
}
