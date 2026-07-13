import { INOCHI_WORDMARK_AVIF } from "@/generated/inochi-wordmark";
import { cn } from "@/lib/utils";

export function InochiWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="inochi"
      role="img"
      className={cn("inline-flex items-baseline whitespace-nowrap", className)}
      style={{ fontFamily: "var(--font-heading)" }}
    >
      <span className="relative inline-block h-[1em] w-[2.773em]">
        {/* The bitmap carries 24/1000em of padding below the baseline so glyph
            feet are not flush with its edge; it overflows the 1em span by that
            amount while the span itself still bottoms out on the baseline. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={INOCHI_WORDMARK_AVIF}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="sync"
          className="absolute left-0 top-0 h-[1.024em] w-full max-w-none"
        />
      </span>
      {/* Zero-width strut: reproduces the line box the live "nochi" text gave
          the component (1.75rem at text-xl), so the wordmark's outer height
          and baseline seating stay exactly as they were pre-baking. */}
      <span aria-hidden="true" className="inline-block w-0 overflow-hidden">
        &nbsp;
      </span>
    </span>
  );
}
