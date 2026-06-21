"use client";

import { seedEmojis, type Emoji } from "@/lib/api";

export function SeedEmojis({ emojis }: { emojis: Emoji[] }) {
  if (emojis.length) seedEmojis(emojis);
  return null;
}
