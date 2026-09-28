import type { LinkPreview } from "@/lib/api";

const TRAILING_URL = /(https?:\/\/[^\s<>()[\]{}"']+)\s*$/;
const URL_TRAIL = /[.,!?;:'"]+$/;
const LEADING_TAGS = /^\s*#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*(?=\s|$)/u;
const TRAILING_TAGS = /(?:^|\s)#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*\s*$/u;
const TAG = /#([\p{L}\p{N}_]+)/gu;

export function previewHasText(preview: LinkPreview): boolean {
  return !!(preview.title || preview.description || preview.author);
}

interface PreviewText {
  text: string;
  tags: string[];
  taggedUrl: string | null;
}

export function splitPreviewText(content: string, previews: LinkPreview[]): PreviewText {
  const shown = previews.filter(previewHasText).map((p) => p.url);
  if (shown.length === 0) return { text: content, tags: [], taggedUrl: null };

  const shownSet = new Set(shown);
  let text = content;
  let m = text.match(TRAILING_URL);
  while (m && m.index !== undefined && shownSet.has(m[1].replace(URL_TRAIL, ""))) {
    text = text.slice(0, m.index).trimEnd();
    m = text.match(TRAILING_URL);
  }

  const tags: string[] = [];
  const take = (run: string) => {
    for (const t of run.matchAll(TAG)) if (!tags.includes(t[1])) tags.push(t[1]);
  };
  const lead = text.match(LEADING_TAGS);
  if (lead) {
    take(lead[0]);
    text = text.slice(lead[0].length).trimStart();
  }
  const trail = text.match(TRAILING_TAGS);
  if (trail && trail.index !== undefined) {
    take(trail[0]);
    text = text.slice(0, trail.index).trimEnd();
  }

  return { text, tags, taggedUrl: tags.length > 0 ? shown[0] : null };
}
