"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { TzProvider } from "@/lib/tz";
import { NavBar } from "@/components/nav-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scrollToTop } from "@/lib/scroll";

export function Providers({ children, initialAuthed, tz }: { children: React.ReactNode; initialAuthed: boolean; tz: string | undefined }) {
  const pathname = usePathname();

  // Open static content pages at the very top. The global `scroll-behavior:
  // smooth` lets the router's own scroll reset animate and get interrupted by
  // the incoming page's reflow, leaving it partway down the previous page — so
  // pin the top explicitly (instantly) on entry. The home timeline (restores or
  // resets its own scroll) and post pages (scroll to the hashed reply) manage
  // their own position and are excluded.
  useLayoutEffect(() => {
    if (pathname === "/" || pathname.startsWith("/post/")) return;
    scrollToTop();
  }, [pathname]);

  return (
    <AuthProvider initialAuthed={initialAuthed}>
      <TzProvider initial={tz}>
      <TooltipProvider>
        <NavBar />
        <main className="mx-auto max-w-[632px] px-4 pt-2.5 pb-4">
          {children}
        </main>
        <Toaster />
      </TooltipProvider>
      </TzProvider>
    </AuthProvider>
  );
}
