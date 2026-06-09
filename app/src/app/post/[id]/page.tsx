"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPost, Post } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { PostCard } from "@/components/post-card";
import { PostEditor } from "@/components/post-editor";
import { Skeleton } from "@/components/ui/skeleton";

export default function PostPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [followups, setFollowups] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openEditor, setOpenEditor] = useState<string | null>(null);

  // Apply a fetched thread to state. Shared by the initial load and refetches.
  const applyThread = useCallback(
    (res: { post: Post; followups: Post[] }) => {
      // The thread always shows from the very original root; if this id is an
      // echo, redirect to the root page (keeping the skeleton up) and scroll to
      // this echo there.
      if (res.post.root_post_id && res.post.root_post_id !== res.post.id) {
        router.replace(`/post/${res.post.root_post_id}#${res.post.id}`);
        return;
      }
      setPost(res.post);
      setFollowups(res.followups);
      // An `echo` param (set when echoing from elsewhere) opens that post's
      // composer; otherwise composers are opened on demand per card.
      const echo = new URLSearchParams(window.location.search).get("echo");
      if (echo) setOpenEditor(echo);
      setLoading(false);
    },
    [router],
  );

  const load = useCallback(async () => {
    try {
      applyThread(await getPost(id));
    } catch {
      setLoading(false);
    }
  }, [id, applyThread]);

  // Fetch on mount / when the id changes. The state update runs in the async
  // continuation, and a cancellation flag drops a stale response if the id
  // changes (or the component unmounts) before it resolves.
  useEffect(() => {
    let active = true;
    getPost(id)
      .then((res) => {
        if (active) applyThread(res);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, applyThread]);

  // After the thread renders, scroll to and highlight the post named in the URL
  // hash. Also reacts to in-page hash changes (clicking another post's time).
  useEffect(() => {
    if (loading) return;
    const focus = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const el = document.getElementById(hash);
      if (!el) return;
      // When an echo composer is open for this post (e.g. logged in and opened
      // via ?echo), scroll to the composer so its full height stays in view
      // rather than getting cropped below the centered card.
      const editor = document.getElementById(`echo-input-${hash}`);
      (editor ?? el).scrollIntoView({
        behavior: "smooth",
        block: editor ? "nearest" : "center",
      });
      setHighlight(hash);
    };
    focus();
    window.addEventListener("hashchange", focus);
    return () => window.removeEventListener("hashchange", focus);
  }, [loading, followups]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 1800);
    return () => clearTimeout(t);
  }, [highlight]);

  // Keep a freshly opened composer fully in view (e.g. opened by clicking echo
  // on a card near the bottom of the viewport).
  useEffect(() => {
    if (!openEditor) return;
    document
      .getElementById(`echo-input-${openEditor}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [openEditor]);

  // Only one composer is open at a time; clicking echo on a card opens its
  // composer (closing any other) or closes it if already open.
  const toggleEditor = (postId: string) =>
    setOpenEditor((prev) => (prev === postId ? null : postId));

  // Group echoes by their parent once, so each render of the (recursive) tree
  // is a map lookup per node instead of re-scanning the whole `followups` list.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const f of followups) {
      if (!f.parent_post_id) continue;
      const siblings = map.get(f.parent_post_id);
      if (siblings) siblings.push(f);
      else map.set(f.parent_post_id, [f]);
    }
    return map;
  }, [followups]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!post) {
    return <p className="text-center text-muted-foreground py-8">Post not found</p>;
  }

  // When the whole thread is by a single author, the repeated name on every
  // echo is redundant — show it only on the root card.
  const singleAuthor = new Set([post, ...followups].map((p) => p.user_id)).size === 1;

  return <div>{renderNode(post)}</div>;

  // Render a post and its echoes. A linear chain (each post answered by a single
  // echo) stays a flat stack of equal full-size cards; only where a post has two
  // or more parallel echoes do the branches indent under a connecting rail.
  function renderNode(node: Post) {
    const children = childrenByParent.get(node.id) ?? [];
    return (
      <div key={node.id}>
        <PostCard
          post={node}
          hideParent
          hideUsername={singleAuthor && node.id !== post!.id}
          onUpdate={load}
          onDelete={(deletedId) =>
            deletedId === post!.id
              ? window.history.length > 1
                ? router.back()
                : router.replace("/")
              : load()
          }
          onEcho={user ? toggleEditor : undefined}
          className={cn(highlight === node.id && "ring-2 ring-primary transition-shadow")}
        />

        {user && openEditor === node.id && (
          <div id={`echo-input-${node.id}`} className="mt-3 scroll-mt-20 scroll-mb-6">
            <PostEditor
              parentPostId={node.id}
              placeholder="Write an echo..."
              onPostCreated={load}
            />
          </div>
        )}

        {children.length === 1 && <div className="mt-4">{renderNode(children[0])}</div>}

        {children.length > 1 && (
          <div className="mt-4 space-y-4 border-l-2 border-border/60 pl-4">
            {children.map((c) => renderNode(c))}
          </div>
        )}
      </div>
    );
  }
}
