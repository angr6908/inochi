"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

// The viewer's IANA timezone (e.g. "America/Los_Angeles"), seeded on the server
// from the `tz` cookie so timestamps render in the viewer's zone during SSR —
// making the server's HTML match what the client computes, with no hydration
// swap. Undefined until the cookie exists (first visit), where it falls back to
// the runtime default and is corrected on mount.
const TzContext = createContext<string | undefined>(undefined);

export function useTz(): string | undefined {
  return useContext(TzContext);
}

export function TzProvider({
  initial,
  children,
}: {
  initial: string | undefined;
  children: React.ReactNode;
}) {
  // SSR (and the hydrating render) read `initial` from the cookie so the markup
  // matches; once mounted the client snapshot takes over with the browser's real
  // zone, re-rendering timestamps into it when the cookie was absent or stale.
  const tz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => initial,
  );

  // Persist a corrected zone so the next SSR is already seeded with it.
  useEffect(() => {
    if (!tz || tz === initial) return;
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
  }, [tz, initial]);

  return <TzContext.Provider value={tz}>{children}</TzContext.Provider>;
}
