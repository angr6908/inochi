"use client";

import { useMemo, useState } from "react";
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

  // Posts that fit at every width render exactly as before — no wrapper, no
  // toggle, nothing to clip.
  if (!clamp) return <PostContent content={content} priority={priority} />;

  // Toggling never moves the page. Collapsing removes text that sits above the
  // toggle, so the browser's own scroll anchoring absorbs it and whatever you
  // were looking at — the button under the cursor included — stays put. An
  // explicit scroll here (this used to re-anchor the post's top under the nav)
  // would be a jump the reader didn't ask for.
  const toggle = () => setExpanded((v) => !v);

  return (
    <div
      className="post-clamp"
      data-clamp={clamp}
      data-expanded={expanded ? "" : undefined}
      style={{ "--post-clamp-lines": POST_CLAMP_LINES } as CSSProperties}
    >
      <div className="post-clamp-body">
        <PostContent content={content} priority={priority} />
      </div>
      {/* text-sm to match the post's other affordances — the Echo/Edit/Delete
          items in the actions menu — rather than the post text it sits under.
          leading-6 (24px) rather than the 21px text-sm pairs with: that keeps
          the line box a hair off one content line (24.375px), so the card's
          bottom spacing (the `[&:last-child]:-mb-[4px]` pull on the wrapper)
          lands where it does for a text-only card. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="post-clamp-toggle mt-1 font-sans text-sm leading-6 font-medium text-primary hover:underline"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
