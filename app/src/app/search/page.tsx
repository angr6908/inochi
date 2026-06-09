"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { searchPosts, Post } from "@/lib/api";
import { PostCard } from "@/components/post-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PostListSkeleton } from "@/components/post-list-skeleton";
import { PostPagination } from "@/components/post-pagination";

function SearchContent() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (searchQuery: string, p = 1) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await searchPosts(searchQuery, p);
      setPosts(res.posts);
      setPage(res.page);
      setPages(res.pages);
      setTotal(res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const searched = useRef<string | null>(null);
  useEffect(() => {
    if (searched.current === q) return;
    searched.current = q;
    search(q);
  }, [q, search]);

  return (
    <div className="space-y-4">
      {loading ? (
        <PostListSkeleton />
      ) : posts.length === 0 && q ? (
        <p className="text-center text-muted-foreground py-8">No results for &ldquo;{q}&rdquo;</p>
      ) : (
        <>
          {total > 0 && (
            <p className="text-sm text-muted-foreground">{total} result{total !== 1 ? "s" : ""}</p>
          )}
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onUpdate={() => search(q, page)} />
            ))}
          </div>
          <PostPagination page={page} pages={pages} onChange={(p) => search(q, p)} />
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      <SearchContent />
    </Suspense>
  );
}
