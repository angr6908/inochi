"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Post } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PostCard } from "./post-card";

interface PostFeedProps {
  posts: Post[];
  onUpdate: () => void;
  /** Which loaded page of the same feed holds a given post. Lets an echo whose
   *  original sits on another page point at it instead of quoting it again. */
  pageOfPost?: (id: string) => number | undefined;
  /** Turn to another page and focus a post there (see `pageOfPost`). */
  onJumpToPage?: (page: number, id: string) => void;
  /** A post on this page to scroll to and highlight — set by the parent when the
   *  reader arrives here from another page. Every jump passes a new object. */
  focus?: { id: string } | null;
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
// shown twice: whoever wrote it, when an echo's original is also in the feed we
// drop the echo's inline quote of it. If the original is the adjacent card it
// already reads as a joined thread; if it's elsewhere in the feed — further down
// this page, or on another loaded page — the echo instead gets a compact
// reference (see `parentLink`) that jumps to it, so the connection stays clear
// without repeating the content or disturbing the time order.
export function PostFeed({ posts, onUpdate, pageOfPost, onJumpToPage, focus }: PostFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const idsOnPage = new Set(posts.map((p) => p.id));
  const priorityIndex = posts.findIndex(hasMedia);

  // Clicking an echo's reference scrolls to the echoed original and briefly
  // highlights it — same treatment as the thread page — rather than navigating
  // away. The highlight clears after a moment.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(t);
  }, [highlightId]);

  // Centre a post on this page and highlight it. A same-page jump glides; an
  // arrival from another page lands instantly, since every card under the
  // viewport has just been replaced and there is nothing to glide over. The
  // instant landing re-pins on the next frame, once layout has settled.
  const focusPost = useCallback((id: string, smooth: boolean) => {
    const scroll = () =>
      document.getElementById(id)?.scrollIntoView({
        behavior: smooth ? "smooth" : "instant",
        block: "center",
      });
    scroll();
    if (!smooth) requestAnimationFrame(scroll);
    setHighlightId(id);
  }, []);

  // A fresh `focus` object means the reader just arrived from another page.
  // Before paint, so the new page is never shown at the old scroll offset first.
  useLayoutEffect(() => {
    if (!focus) return;
    focusPost(focus.id, false);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = feedRef.current?.animate(
      [
        { opacity: 0.72, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => animation?.cancel();
  }, [focus, focusPost]);

  const jumpToPost = (id: string) => {
    if (idsOnPage.has(id)) {
      focusPost(id, true);
      return;
    }
    const p = pageOfPost?.(id);
    if (p !== undefined) onJumpToPage?.(p, id);
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
    <div ref={feedRef}>
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
        // The echoed original on another loaded page (typically the next one,
        // where pagination split the thread): still reachable, so it counts as
        // being in the feed — clicking the reference turns to that page.
        const parentPage = parent && !parentOnPage ? pageOfPost?.(parent.id) : undefined;
        const parentInFeed = parentOnPage || parentPage !== undefined;
        // Drop the inline quote whenever the original is in the feed: as the
        // adjacent card it reads as a joined thread, and anywhere else the
        // reference below stands in for it.
        const hideParent = parentAdjacent || parentInFeed;
        // In the feed but not the neighbouring card: a slim link keeps the echo
        // legible without repeating the quote or reordering the feed. It names
        // the author when the echo answers someone else, since the two cards can
        // sit far apart.
        const parentLink =
          parent && parentInFeed && !parentAdjacent
            ? {
                id: parent.id,
                created_at: parent.created_at,
                username: parent.username === post.username ? undefined : parent.username,
              }
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
