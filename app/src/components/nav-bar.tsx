"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { preloadAboutFonts } from "@/lib/font-preload";
import { requestHomeLogoReset } from "@/lib/home-reset";
import { scrollToTop } from "@/lib/scroll";
import { Button } from "@/components/ui/button";
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

export function NavBar({ scrolled }: { scrolled?: boolean }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

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
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-background">
      <div className="mx-auto flex h-14 max-w-[600px] items-center gap-3 px-4 sm:gap-4 sm:px-0">
        {searchOpen ? (
          <form onSubmit={handleSearch} className="flex flex-1 items-center gap-2">
            <Input
              autoFocus
              placeholder="Search posts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 min-w-0 flex-1"
            />
            <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => setSearchOpen(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <Link href="/" prefetch onClick={handleLogo} className="shrink-0 text-xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
              inochi
            </Link>

            <form onSubmit={handleSearch} className="hidden min-w-0 flex-1 min-[400px]:block sm:max-w-sm">
              <Input
                placeholder="Search posts..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9"
              />
            </form>

            <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Search"
                className="size-7 min-[400px]:hidden"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-4" />
              </Button>
              <Link href="/about" prefetch>
                <Button variant="ghost" size="sm">About</Button>
              </Link>
              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="sm" className="max-w-[40vw] gap-1.5 font-medium" />
                    }
                  >
                    <span className="truncate">{user.username}</span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
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
                <Skeleton className="h-8 w-20 rounded-md" />
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
          </>
        )}
      </div>

      {/* Hairline below the nav, shown only once content scrolls past the
          nav's bottom edge (`scrolled`, from providers.tsx). Sized a little
          wider than the 600px post column (20px overhang each side). Toggled
          instantly with no animation. Click-through, no layout shift. */}
      {scrolled && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-full mx-auto h-px w-full max-w-[640px] bg-border"
        />
      )}
    </header>
  );
}
