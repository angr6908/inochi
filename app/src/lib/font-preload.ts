import { Post } from "@/lib/api";

// Content font stack (globals.css --font-content): Roboto for Latin, Noto Sans
// JP for CJK. Both are sliced by unicode-range, so a page with new CJK glyphs
// fetches fresh subsets on render and visibly swaps from the fallback. Warming
// those subsets ahead of time (with the page's actual text) makes the next page
// paint in the right font with no swap.
const FONT_VARS = ["--font-roboto", "--font-noto-sans-jp"];
const WEIGHTS = ["400", "700"];

export function preloadPostFonts(posts: Post[]) {
  if (typeof document === "undefined" || !document.fonts?.load) return;

  let text = "";
  for (const post of posts) {
    text += post.content;
    if (post.parent_post) text += post.parent_post.content;
  }
  if (!text) return;

  const cs = getComputedStyle(document.documentElement);
  for (const v of FONT_VARS) {
    const stack = cs.getPropertyValue(v).trim();
    const family = stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (!family) continue;
    for (const w of WEIGHTS) {
      document.fonts.load(`${w} 1em "${family}"`, text).catch(() => {});
    }
  }
}

export function postFontsReady(posts: Post[], timeoutMs = 200): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return Promise.resolve();

  let text = "";
  for (const post of posts) {
    text += post.content;
    if (post.parent_post) text += post.parent_post.content;
  }
  if (!text) return Promise.resolve();

  const cs = getComputedStyle(document.documentElement);
  const loads: Promise<unknown>[] = [];
  for (const v of FONT_VARS) {
    const stack = cs.getPropertyValue(v).trim();
    const family = stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
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
