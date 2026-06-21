import { BACKEND_ORIGIN } from "@/lib/site";
import type { Emoji } from "@/lib/api";

export async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_ORIGIN}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchEmojis(): Promise<Emoji[]> {
  return (await serverGet<{ emojis: Emoji[] }>("/api/emojis"))?.emojis ?? [];
}
