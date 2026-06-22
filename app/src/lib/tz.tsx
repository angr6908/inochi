"use client";

import { createContext, useContext, useEffect, useState } from "react";

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
  const [tz, setTz] = useState(initial);

  useEffect(() => {
    const real = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!real || real === tz) return;
    document.cookie = `tz=${encodeURIComponent(real)}; path=/; max-age=31536000; samesite=lax`;
    setTz(real);
  }, [tz]);

  return <TzContext.Provider value={tz}>{children}</TzContext.Provider>;
}
