"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { NavBar } from "@/components/nav-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Height of the sticky nav's inner row (h-14). The scroll sentinel offsets the
// viewport by this so it trips exactly at the nav's bottom edge.
const NAV_HEIGHT = 56;

export function Providers({ children, initialAuthed }: { children: React.ReactNode; initialAuthed: boolean }) {
  // The nav's hairline shows only once content has scrolled up past the nav's
  // bottom edge. A zero-height sentinel at the top of the content, watched with
  // the nav's height shaved off the viewport top, flips `stuck` exactly at that
  // crossing — an observer, so there's no per-scroll work, and it reads cleanly
  // whether you scroll, resize, or restore.
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: `-${NAV_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <AuthProvider initialAuthed={initialAuthed}>
      <TooltipProvider>
        <NavBar scrolled={stuck} />
        <main className="mx-auto max-w-[600px] px-4 pt-2.5 pb-4 sm:px-0">
          <div ref={sentinelRef} aria-hidden className="h-0" />
          {children}
        </main>
        <Toaster />
      </TooltipProvider>
    </AuthProvider>
  );
}
