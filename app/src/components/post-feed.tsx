"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Post } from "@/lib/api";
import type { ImagePriority } from "@/lib/image-loader";
import { FIRST_SCREEN_POSTS, hasShownImage } from "@/lib/post-media";
import { localTime } from "@/lib/timeline";
import { useTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { PostCard } from "./post-card";
import { TimelineDate, TimelineTime } from "./timeline";

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
  timeline?: boolean;
}

function laneClass(echo: boolean, thread: boolean): string {
  if (echo) return "left-[10px] w-[3px] rounded-full bg-primary/45";
  if (thread) return "left-[11px] w-0 border-l border-dashed border-primary/60";
  return "left-[11px] w-px bg-border";
}

const HIGH_PRIORITY_POSTS = 1;

function imagePriorities(posts: Post[]): (ImagePriority | undefined)[] {
  let high = 0;
  return posts.map((post, i) => {
    if (i >= FIRST_SCREEN_POSTS) return undefined;
    if (high < HIGH_PRIORITY_POSTS && hasShownImage(post)) {
      high += 1;
      return "high";
    }
    return "eager";
  });
}

// Posts are rendered in the order given (time order). No post's content is ever
// shown twice: whoever wrote it, when an echo's original is also in the feed we
// drop the echo's inline quote of it. If the original is the adjacent card it
// already reads as a joined thread; if it's elsewhere in the feed — further down
// this page, or on another loaded page — the echo instead gets a compact
// reference (see `parentLink`) that jumps to it, so the connection stays clear
// without repeating the content or disturbing the time order.
export function PostFeed({ posts, onUpdate, pageOfPost, onJumpToPage, focus, timeline }: PostFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const tz = useTz();
  const idsOnPage = new Set(posts.map((p) => p.id));
  const priorities = imagePriorities(posts);

  // Clicking an echo's reference scrolls to the echoed original and briefly
  // highlights it — same treatment as the thread page — rather than navigating
  // away. The highlight clears after a moment.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(t);
  }, [highlightId]);

  // Centre a post on this page. A same-page jump glides; an arrival from
  // another page lands instantly, since every card under the viewport has just
  // been replaced and there is nothing to glide over. The instant landing
  // re-pins on the next frame, once layout has settled.
  const scrollToPost = useCallback((id: string, smooth: boolean) => {
    const scroll = () =>
      document.getElementById(id)?.scrollIntoView({
        behavior: smooth ? "smooth" : "instant",
        block: "center",
      });
    scroll();
    if (!smooth) requestAnimationFrame(scroll);
  }, []);

  // Centre a post and highlight it: what a same-page jump does.
  const focusPost = useCallback(
    (id: string, smooth: boolean) => {
      scrollToPost(id, smooth);
      setHighlightId(id);
    },
    [scrollToPost],
  );

  // A fresh `focus` object means the reader just arrived from another page, so
  // that post takes the highlight. Derived during render rather than set from
  // the effect below: the effect owns DOM work (scroll, entrance animation),
  // and adjusting here avoids the extra render pass a setState-in-effect
  // queues. See "adjusting state when a prop changes" in the React docs.
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    setHighlightId(focus ? focus.id : null);
  }

  // Before paint, so the new page is never shown at the old scroll offset first.
  useLayoutEffect(() => {
    if (!focus) return;
    scrollToPost(focus.id, false);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = feedRef.current?.animate(
      [
        { opacity: 0.72, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => animation?.cancel();
  }, [focus, scrollToPost]);

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

  const renderPost = (i: number, timeline = false) => {
    const post = posts[i];
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
      parent && parentInFeed && (timeline || !parentAdjacent)
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
        priority={priorities[i]}
        echoVisible={echoVisible}
        echoInMenu
        hideParent={hideParent}
        parentLink={parentLink}
        onJumpToPost={jumpToPost}
        hideUsername={sameAuthorAsNext}
        onUpdate={onUpdate}
        join={
          sameThreadAsNext
            ? sameThreadAsPrev
              ? "both"
              : "next"
            : sameThreadAsPrev
              ? "prev"
              : "none"
        }
        highlighted={i === targetIdx}
        // The highlighted card keeps the seam it would otherwise hand down,
        // so the card below must not draw that border a second time.
        borderTop={!(targetMergedNext && i === targetIdx + 1)}
        className={
          timeline
            ? undefined
            : cn(sameThreadAsNext ? "mb-0" : "mb-4", i === posts.length - 1 && "mb-0")
        }
        timeline={timeline}
      />
    );
  };

  if (!timeline) {
    return <div ref={feedRef}>{posts.map((_, i) => renderPost(i))}</div>;
  }

  const dayKeys = posts.map((post) => localTime(post.created_at, tz).key);
  const days: number[][] = [];
  posts.forEach((_, i) => {
    if (i === 0 || dayKeys[i] !== dayKeys[i - 1]) days.push([i]);
    else days[days.length - 1].push(i);
  });

  const renderRow = (i: number) => {
    const post = posts[i];
    const above = posts[i - 1];
    const below = posts[i + 1];
    const echoedAbove = !!above && above.parent_post_id === post.id;
    const echoesBelow = !!below && post.parent_post_id === below.id;
    const threadAbove = !!above && above.root_post_id === post.root_post_id;
    const threadBelow = !!below && below.root_post_id === post.root_post_id;
    const dayStart = i === 0 || dayKeys[i] !== dayKeys[i - 1];
    const dayEnds = !!below && dayKeys[i + 1] !== dayKeys[i];
    const last = i === posts.length - 1;
    return (
      <li key={post.id} data-timeline-day={post.created_at} className="flex">
        <TimelineTime date={post.created_at} dayStart={dayStart} />
        <div
          className={cn(
            "relative min-w-0 flex-1 pl-7",
            !last && (threadBelow ? "pb-4" : dayEnds ? "pb-10" : "pb-6"),
          )}
        >
          {!last && (
            <span aria-hidden className={cn("absolute top-2 -bottom-2", laneClass(echoesBelow, threadBelow))} />
          )}
          <span
            aria-hidden
            className={cn(
              "absolute rounded-full",
              i === targetIdx
                ? "top-[3px] left-[6.5px] size-[10px] bg-primary ring-4 ring-primary/20"
                : post.parent_post_id
                  ? "top-[4.5px] left-[8px] size-[7px] bg-primary ring-2 ring-background"
                  : echoedAbove || threadAbove
                    ? "top-[2.5px] left-[6px] size-[11px] border-2 border-primary bg-background"
                    : "top-[3.5px] left-[7px] size-[9px] border-[1.5px] border-muted-foreground/60 bg-background",
            )}
          />
          {renderPost(i, true)}
        </div>
      </li>
    );
  };

  return (
    <div ref={feedRef}>
      {days.map((day) => (
        <section key={posts[day[0]].id} className="relative">
          <TimelineDate date={posts[day[0]].created_at} />
          <ol>{day.map(renderRow)}</ol>
        </section>
      ))}
    </div>
  );
}
