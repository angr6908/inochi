"use client";

import { useEffect, useState } from "react";
import { Post } from "@/lib/api";
import { PostCard } from "./post-card";
import { cn } from "@/lib/utils";

interface PostFeedProps {
  posts: Post[];
  onUpdate: () => void;
}

const CUSTOM_EMOJI = /:[a-z0-9_]*[a-z_][a-z0-9_]*:/i;

function hasMedia(p: Post): boolean {
  return (
    p.images.length > 0 ||
    p.link_previews.some((lp) => lp.thumbnail || lp.image_url) ||
    CUSTOM_EMOJI.test(p.content)
  );
}

// Posts are rendered in the order given (time order). No post's content is ever
// shown twice: when an echo's original is also on the page we drop the echo's
// inline quote of it. If the original is the adjacent card it already reads as a
// joined thread; if it's elsewhere on the page the echo instead gets a compact
// reference (see `parentLink`) that scrolls to it, so the connection stays clear
// without repeating the content or disturbing the time order.
export function PostFeed({ posts, onUpdate }: PostFeedProps) {
  const idsOnPage = new Set(posts.map((p) => p.id));
  const priorityIndex = posts.findIndex(hasMedia);

  // Clicking an echo's reference scrolls to the echoed original (already on the
  // page) and briefly highlights it — same treatment as the thread page — rather
  // than navigating away. The highlight clears after a moment.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(t);
  }, [highlightId]);
  const jumpToPost = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
  };

  const targetIdx = highlightId ? posts.findIndex((p) => p.id === highlightId) : -1;
  // A target merged with the card below has no bottom border for the inset
  // outline to align to, so restore one (and drop that card's top border to keep
  // the layout unchanged) — the outline then sits on it just like the other sides.
  const targetMergedNext =
    targetIdx >= 0 &&
    targetIdx < posts.length - 1 &&
    posts[targetIdx + 1].root_post_id === posts[targetIdx].root_post_id;

  return (
    <div>
      {posts.map((post, i) => {
        const next = posts[i + 1];
        const prev = posts[i - 1];
        const parent = post.parent_post;
        const continuesPrev = !!(prev?.parent_post && prev.parent_post.id === post.id);
        const sameThreadAsNext = !!(next && next.root_post_id === post.root_post_id);
        const sameThreadAsPrev = !!(prev && prev.root_post_id === post.root_post_id);
        const sameAuthorAsNext = sameThreadAsNext && next?.username === post.username;
        const parentOnPage = !!(parent && idsOnPage.has(parent.id));
        const parentAdjacent =
          !!parent && (parent.id === next?.id || parent.id === prev?.id);
        // Only deduplicate a self-echo: when a post echoes the same author's own
        // earlier post that's also on the page, the surrounding cards already give
        // the context, so we don't repeat it. A cross-author echo keeps its full
        // quote for context even if the quoted post happens to be on the page.
        const sameAuthor = !!parent && parent.username === post.username;
        // Drop the inline quote when the original is the adjacent card (it reads as
        // a joined thread) or when it's the same author elsewhere on the page.
        const hideParent = parentAdjacent || (parentOnPage && sameAuthor);
        // Same author, on the page but not the neighbouring card: a slim link keeps
        // the echo legible without repeating the quote or reordering the feed.
        const parentLink =
          parentOnPage && !parentAdjacent && sameAuthor && parent
            ? { id: parent.id, created_at: parent.created_at }
            : undefined;
        const echoIsNeighbor = continuesPrev;
        // In feeds the echo button is only a way into a post's existing thread,
        // so show it solely when the post has echoes that aren't already shown
        // as an adjacent card.
        const echoVisible = post.followup_count > 0 && !echoIsNeighbor;
        return (
          <PostCard
            key={post.id}
            post={post}
            priority={i === priorityIndex}
            echoVisible={echoVisible}
            echoInMenu
            hideParent={hideParent}
            parentLink={parentLink}
            onJumpToPost={jumpToPost}
            hideUsername={sameAuthorAsNext}
            quoteParentOnly={i === posts.length - 1}
            onUpdate={onUpdate}
            className={cn(
              sameThreadAsNext ? "mb-0" : "mb-4",
              i === posts.length - 1 && "mb-0",
              sameThreadAsNext && "rounded-b-none border-b-0",
              sameThreadAsPrev && "rounded-t-none",
              // Highlight on the border: a single inset outline traces the target
              // card's own box, so corners are always correct — including squared
              // merge edges — with no layout shift and no bleed onto neighbours.
              i === targetIdx && "outline outline-1 outline-primary outline-offset-[-1px]",
              i === targetIdx && targetMergedNext && "border-b",
              targetMergedNext && i === targetIdx + 1 && "border-t-0",
            )}
          />
        );
      })}
    </div>
  );
}
