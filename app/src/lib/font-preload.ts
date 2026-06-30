import { Post } from "@/lib/api";

// Content font stack (globals.css --font-content): Roboto for Latin, Noto Sans
// JP for CJK. Both are sliced by unicode-range, so a page with new CJK glyphs
// fetches fresh subsets on render and visibly swaps from the fallback. Warming
// those subsets ahead of time (with the page's actual text) makes the next page
// paint in the right font with no swap.
const FONT_VARS = ["--font-roboto", "--font-noto-sans-jp"];
const WEIGHTS = ["400", "700"];

function cleanFamily(token: string): string {
  return token.trim().replace(/^["']|["']$/g, "");
}

// All text a page actually paints, so the right font subsets are warmed: each
// post's content, its quoted parent, and any reconstructed ancestor thread the
// timeline renders beneath a reply.
function pageText(posts: Post[]): string {
  let text = "";
  for (const post of posts) {
    text += post.content;
    if (post.parent_post) text += post.parent_post.content;
    for (const anc of post.ancestors ?? []) text += anc.content;
  }
  return text;
}

export function preloadPostFonts(posts: Post[]) {
  if (typeof document === "undefined" || !document.fonts?.load) return;

  const text = pageText(posts);
  if (!text) return;

  const cs = getComputedStyle(document.documentElement);
  for (const v of FONT_VARS) {
    const family = cleanFamily(cs.getPropertyValue(v).split(",")[0]);
    if (!family) continue;
    for (const w of WEIGHTS) {
      document.fonts.load(`${w} 1em "${family}"`, text).catch(() => {});
    }
  }
}

const ABOUT_FONT_VARS = ["--font-heading", "--font-noto-sans-jp"];
const ABOUT_TEXT =
  "命inochi" +
  "いかにして「命」という檻を越えるのか。" +
  "How to escape from the prison of existence?" +
  "作爲「存在」之産物的生命體，如何從時間的牢籠中逃離？" +
  "It may be the last and greatest jailbreak for all humankind.";

export function preloadAboutFonts() {
  if (typeof document === "undefined" || !document.fonts?.load) return;

  const cs = getComputedStyle(document.documentElement);
  const families = new Set<string>();
  for (const v of ABOUT_FONT_VARS) {
    for (const part of cs.getPropertyValue(v).split(",")) {
      const family = cleanFamily(part);
      if (family && family !== "sans-serif") families.add(family);
    }
  }
  for (const family of families) {
    for (const w of WEIGHTS) {
      document.fonts.load(`${w} 1em "${family}"`, ABOUT_TEXT).catch(() => {});
    }
  }
}

export function postFontsReady(posts: Post[], timeoutMs = 200): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return Promise.resolve();

  const text = pageText(posts);
  if (!text) return Promise.resolve();

  const cs = getComputedStyle(document.documentElement);
  const loads: Promise<unknown>[] = [];
  for (const v of FONT_VARS) {
    const family = cleanFamily(cs.getPropertyValue(v).split(",")[0]);
    if (!family) continue;
    for (const w of WEIGHTS) {
      loads.push(document.fonts.load(`${w} 1em "${family}"`, text).catch(() => {}));
    }
  }
  if (loads.length === 0) return Promise.resolve();

  return Promise.race([
    Promise.all(loads).then(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
