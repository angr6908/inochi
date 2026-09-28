"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth-context";
import { preloadAboutFonts } from "@/lib/font-preload";
import { requestHomeLogoReset } from "@/lib/home-reset";
import { scrollToTop } from "@/lib/scroll";
import { localTime, monthDay, relativeDay } from "@/lib/timeline";
import { getTimelineDay, subscribeTimelineDay } from "@/lib/timeline-day";
import { useTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InochiWordmark } from "@/components/inochi-wordmark";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const HOME_LOGO_RESET_PATHS = new Set([
  "/about",
  "/settings",
  "/search",
  "/auth/signin",
  "/auth/signup",
]);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function DayIndicator() {
  const date = useSyncExternalStore(subscribeTimelineDay, getTimelineDay, () => null);
  const tz = useTz();
  const [now] = useState(() => Date.now());
  if (!date) return null;
  const t = localTime(date, tz);
  const day = relativeDay(t, now, tz);
  const label = day.year ? `${day.label}, ${day.year}` : day.label;
  const short = day.label === "Yesterday" ? monthDay(t) : null;
  return (
    <span
      key={label}
      className="flex min-w-0 animate-in items-center gap-1.5 duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className={cn("truncate text-[0.8rem] font-semibold", short && "hidden @min-[76px]:inline")}>{label}</span>
      {short && <span className="truncate text-[0.8rem] font-semibold @min-[76px]:hidden">{short}</span>}
    </span>
  );
}

function Avatar({ name, inline }: { name: string; inline?: boolean }) {
  return (
    <span
      aria-hidden
      data-icon={inline ? "inline-start" : undefined}
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary uppercase"
    >
      {Array.from(name)[0]}
    </span>
  );
}

export function NavBar() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Scroll position captured when the search opens, so we can restore it on
  // close.
  const scrollBeforeSearch = useRef(0);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const inlineSearchRef = useRef<HTMLInputElement>(null);

  // Focus the search field when it opens, with `preventScroll` so iOS Safari
  // doesn't scroll the page to "reveal" it. The field sits in a position:fixed
  // header, so it's already visible, but iOS's focus scroll-into-view
  // miscalculates a fixed element's position and shoves the post content. Done
  // here (not via autoFocus) because autoFocus can't pass preventScroll.
  useEffect(() => {
    if (searchOpen) searchFormRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [searchOpen]);

  const openSearch = useCallback(() => {
    scrollBeforeSearch.current = window.scrollY;
    setSearchOpen(true);
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    const y = scrollBeforeSearch.current;
    // Restore now and again after the keyboard finishes dismissing (iOS keeps
    // adjusting scroll for a beat after blur). Instant, to bypass the global
    // smooth scroll-behavior.
    const restore = () => window.scrollTo({ top: y, left: 0, behavior: "instant" });
    requestAnimationFrame(restore);
    setTimeout(restore, 300);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      const inline = inlineSearchRef.current;
      if (inline && inline.offsetParent !== null) inline.focus({ preventScroll: true });
      else openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  useEffect(() => {
    if (pathname === "/about") return;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => preloadAboutFonts());
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(preloadAboutFonts, 300);
    return () => clearTimeout(t);
  }, [pathname]);

  const handleLogo = (e: React.MouseEvent) => {
    if (pathname === "/") {
      e.preventDefault();
      window.dispatchEvent(new Event("home:reset"));
      scrollToTop();
    } else if (HOME_LOGO_RESET_PATHS.has(pathname)) {
      if (pathname === "/search") {
        setQuery("");
        setSearchOpen(false);
      }
      requestHomeLogoReset();
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      setSearchOpen(false);
      inlineSearchRef.current?.blur();
    }
  };

  return (
    <>
    {/* `fixed` (not `sticky`) keeps the nav out of the scrolling content's
        flow, and translateZ pins it to its own compositing layer. Together
        they mean a route change's reflow under the nav can never repaint or
        blank it — the iOS Safari flicker that `position: sticky` allowed. The
        spacer below reserves its height in normal flow. */}
    <header className="fixed inset-x-0 top-0 z-50 bg-background/90 backdrop-blur-xl backdrop-saturate-150 [transform:translateZ(0)]">
      <div className="mx-auto flex h-14 max-w-[632px] items-center gap-2 px-4 min-[632px]:gap-3">
        {searchOpen ? (
          <form ref={searchFormRef} onSubmit={handleSearch} className="flex flex-1 items-center gap-2">
            <Input
              placeholder="Search posts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              variant="soft"
              className="h-9 min-w-0 flex-1"
            />
            <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={closeSearch}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <Link href="/" prefetch onClick={handleLogo} className="shrink-0">
              <InochiWordmark className="text-xl" />
            </Link>

            <div className="@container flex min-w-0 flex-1 items-center">
              {pathname === "/" && <DayIndicator />}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <search className="relative hidden min-[632px]:block">
                <form onSubmit={handleSearch}>
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={inlineSearchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") e.currentTarget.blur();
                    }}
                    placeholder="Search"
                    aria-label="Search posts"
                    variant="search"
                    className="peer w-40"
                  />
                  <kbd
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted-foreground peer-focus-visible:hidden peer-[:not(:placeholder-shown)]:hidden"
                  >
                    /
                  </kbd>
                </form>
              </search>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Search"
                className="min-[632px]:hidden"
                onClick={openSearch}
              >
                <Search className="size-4" />
              </Button>

              <div className="flex items-center gap-1">
                <Link href="/about" prefetch>
                  <Button variant="ghost" size="sm">About</Button>
                </Link>
                {user ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="sm" className="max-w-40" />}
                    >
                      <Avatar name={user.username} inline />
                      <span className="truncate">{user.username}</span>
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem onClick={() => router.push("/settings")}>
                        Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={signOut}>
                        Sign out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : loading ? (
                  <Skeleton className="h-7 w-32" />
                ) : (
                  <>
                    <Link href="/auth/signin" prefetch>
                      <Button variant="ghost" size="sm">Sign in</Button>
                    </Link>
                    <Link href="/auth/signup" prefetch>
                      <Button size="sm">Sign up</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </header>
    {/* Reserves the fixed nav's height (h-14) in normal flow so content starts
        below it, matching the space the old sticky header occupied. */}
    <div aria-hidden className="h-14" />
    </>
  );
}
