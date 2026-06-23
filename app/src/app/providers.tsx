"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { TzProvider } from "@/lib/tz";
import { NavBar } from "@/components/nav-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scrollToTop } from "@/lib/scroll";

// Height of the sticky nav's inner row (h-14). The scroll sentinel offsets the
// viewport by this so it trips exactly at the nav's bottom edge.
const NAV_HEIGHT = 56;

export function Providers({ children, initialAuthed, tz }: { children: React.ReactNode; initialAuthed: boolean; tz: string | undefined }) {
  // The nav's hairline shows only once content has scrolled up past the nav's
  // bottom edge. A zero-height sentinel at the top of the content, watched with
  // the nav's height shaved off the viewport top, flips `stuck` exactly at that
  // crossing — an observer, so there's no per-scroll work, and it reads cleanly
  // whether you scroll, resize, or restore.
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  // Read the sentinel and flip the hairline. Shared by the scroll listener and
  // the navigation effect (which re-measures once the new page is pinned to top).
  const measure = useCallback(() => {
    rafRef.current = 0;
    const el = sentinelRef.current;
    if (el) setStuck(el.getBoundingClientRect().top <= NAV_HEIGHT);
  }, []);

  // Navigation scrolls back to the top, so the hairline must start hidden on
  // each new page. Reset synchronously when the path changes (before paint), so
  // a stale `stuck` carried over from the previous page never flashes the line
  // in then out; the observer below re-confirms the state for the new content.
  const pathname = usePathname();
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setStuck(false);
  }

  // Open static content pages at the very top. The global `scroll-behavior:
  // smooth` lets the router's own scroll reset animate and get interrupted by
  // the incoming page's reflow, leaving it partway down the previous page — so
  // pin the top explicitly (instantly) on entry. The home timeline (restores or
  // resets its own scroll) and post pages (scroll to the hashed reply) manage
  // their own position and are excluded.
  useLayoutEffect(() => {
    // Drop any hairline measure still queued from the previous page's scroll: it
    // would apply that page's (scrolled) position to the new page and flash the
    // line on for a frame before the new content settles at the top.
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (pathname === "/" || pathname.startsWith("/post/")) return;
    scrollToTop();
    measure();
  }, [pathname, measure]);

  // Toggle the hairline once the content sentinel passes under the nav's bottom
  // edge. A passive, rAF-coalesced scroll listener rather than an
  // IntersectionObserver: on mobile, IO callbacks are batched/deferred during
  // scrolling, so the hairline visibly lagged — it disappeared a beat after you
  // scrolled back to the top. Reading the sentinel's position on each scroll
  // frame tracks the crossing immediately.
  useEffect(() => {
    const onScroll = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    measure();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [measure]);

  return (
    <AuthProvider initialAuthed={initialAuthed}>
      <TzProvider initial={tz}>
      <TooltipProvider>
        <NavBar scrolled={stuck} />
        <main className="mx-auto max-w-[600px] px-4 pt-2.5 pb-4 sm:px-0">
          <div ref={sentinelRef} aria-hidden className="h-0" />
          {children}
        </main>
        <Toaster />
      </TooltipProvider>
      </TzProvider>
    </AuthProvider>
  );
}
