// Deciding whether a post is long enough to clip.
//
// The decision is made from the text alone — never by measuring the rendered
// DOM. Measuring would mean the server HTML paints uncollapsed and hydration
// then collapses it, i.e. exactly the reflow a first load / refresh / SSR'd page
// must not show. A pure function of `content` gives the server and the client
// the same answer, so the first paint is already the collapsed paint and the
// component needs no effect at all.
//
// The cost of not measuring is that the wrap width is unknown, so instead of one
// answer we compute one per viewport bucket and let CSS pick (see the
// `.post-clamp` rules in globals.css). Each bucket is evaluated at the *widest*
// text column it can contain — the fewest lines it can produce — so a post that
// clips in a bucket clips everywhere inside it: the toggle is never a no-op and
// no text is ever hidden without one. The reverse slack is harmless: a post that
// only just overflows renders in full a little past the clamp height.

/** Lines of post text kept visible before a post is clipped. The CSS clamp
 *  height is derived from this same number (PostBody passes it down as
 *  `--post-clamp-lines`), so the threshold and the cut can't drift apart. */
export const POST_CLAMP_LINES = 30;

/** Mean glyph advance of the post font (Roboto 400) at the content size (15px),
 *  in px, over English prose including spaces. */
const AVG_CHAR_PX = 7.5;

/** The widest the post text column gets inside each viewport bucket, in px.
 *  `main` is `mx-auto max-w-[600px] px-4 sm:px-0` and the card adds `p-4`, so
 *  the text measures `min(600, vw) - 64` below the sm breakpoint and 568 at or
 *  above it. Buckets: vw < 420 | 420–519 | >= 520. Keep in sync with the media
 *  queries in globals.css. */
const BUCKET_TEXT_PX = [356, 456, 568];

const CHARS_PER_LINE = BUCKET_TEXT_PX.map((px) => Math.floor(px / AVG_CHAR_PX));

/** The 8px `mb-2` between paragraphs, as a fraction of one 24.375px line. */
const PARA_GAP_LINES = 8 / 24.375;

/** Custom emoji render as a 20px image (≈ 3 characters wide) rather than as the
 *  `:shortcode:` text. Unknown shortcodes stay as text, which is close enough. */
const EMOJI = /:[a-zA-Z0-9_]+:/g;

function visibleChars(line: string): number {
  return line.replace(EMOJI, "___").length;
}

/** Lines a post occupies at a given wrap width, mirroring how PostContent lays
 *  it out: blank-line-separated paragraphs, single newlines kept as breaks by
 *  `whitespace-pre-wrap`. */
function estimateLines(content: string, charsPerLine: number): number {
  const paragraphs = content
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .filter((para) => para !== "");

  let lines = 0;
  paragraphs.forEach((para, i) => {
    if (i > 0) lines += PARA_GAP_LINES;
    for (const line of para.split("\n")) {
      lines += Math.max(1, Math.ceil(visibleChars(line) / charsPerLine));
    }
  });
  return lines;
}

/** The viewport buckets this post overflows in, as a space-separated token list
 *  for `data-clamp` (`[data-clamp~="1"]` in CSS). `undefined` when the post fits
 *  everywhere — then nothing is clipped and no toggle is rendered at all. */
export function postClampBuckets(content: string): string | undefined {
  const buckets = CHARS_PER_LINE.reduce<string[]>((acc, charsPerLine, i) => {
    if (estimateLines(content, charsPerLine) > POST_CLAMP_LINES) acc.push(String(i));
    return acc;
  }, []);
  return buckets.length > 0 ? buckets.join(" ") : undefined;
}
