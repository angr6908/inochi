"use client";

import { useMemo, useRef, useState } from "react";
import { PostContent } from "./post-content";
import { POST_CLAMP_LINES, postClampBuckets } from "@/lib/post-clamp";
import type { CSSProperties } from "react";

/** A post's text, clipped to POST_CLAMP_LINES lines with a Show more/less toggle
 *  when it is long. Which posts clip — and at which viewport widths — is decided
 *  from the text itself (see lib/post-clamp.ts) and handed to CSS as `data-clamp`
 *  tokens, so the server HTML already carries the final, collapsed state. Nothing
 *  is measured and no effect runs, so a first load, a refresh or an SSR'd page
 *  paints the post exactly once, in the shape it keeps. */
export function PostBody({ content, priority }: { content: string; priority?: boolean }) {
  const clamp = useMemo(() => postClampBuckets(content), [content]);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Posts that fit at every width render exactly as before — no wrapper, no
  // toggle, nothing to clip.
  if (!clamp) return <PostContent content={content} priority={priority} />;

  const toggle = () => {
    // Collapsing a post whose top has scrolled off pulls the page out from under
    // the reader; bring the post back first (scroll-mt-20 clears the nav bar).
    if (expanded && (ref.current?.getBoundingClientRect().top ?? 0) < 80) {
      ref.current?.scrollIntoView({ behavior: "instant", block: "start" });
    }
    setExpanded((v) => !v);
  };

  return (
    <div
      ref={ref}
      className="post-clamp scroll-mt-20"
      data-clamp={clamp}
      data-expanded={expanded ? "" : undefined}
      style={{ "--post-clamp-lines": POST_CLAMP_LINES } as CSSProperties}
    >
      <div className="post-clamp-body">
        <PostContent content={content} priority={priority} />
      </div>
      {/* Deliberately inherits the content's size and leading: its line box then
          matches a line of post text, so the card's bottom spacing (the
          `[&:last-child]:-mb-[6px]` pull on the wrapper) lands where it does for
          a text-only card. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="post-clamp-toggle mt-1 font-sans font-medium text-primary hover:underline"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
