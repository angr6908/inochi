// The dark-card variant of a brand mark.
//
// simple-icons ships one hex per brand: the color of the brand's *light-mode*
// mark. That hex is used verbatim on the light card — it is the brand's own
// color on the surface it was drawn for. On the dark card it can fall apart: a
// near-black mark (X #000000, niconico #231815, GitHub #181717) all but
// disappears. Brands solve this by publishing a second variant for dark
// surfaces — X's mark is white in dark mode — so this derives that variant from
// the brand hex.
//
// It is computed here, at render time on the server, and handed to the CSS
// alongside the brand hex as two custom properties: which one paints is decided
// by the `prefers-color-scheme` media query, in the render-blocking stylesheet,
// before the first frame. So a load or a refresh in dark mode never flashes the
// light mark, the server HTML stays theme-agnostic (nothing for hydration to
// mismatch), and flipping the OS theme re-paints with no JS involved.

/** The surface the mark is judged against: `--card` in dark mode (globals.css). */
const CARD_DARK = "#1a1918";

/** Contrast floor on that card — WCAG 2.1's 3:1 minimum for non-text. Reached
 *  by raising lightness alone, which is the adjustment brands make for dark
 *  surfaces themselves, so the mark still reads as the brand's color. Marks that
 *  already clear it (YouTube red, Twitch purple) come back untouched. */
const FLOOR = 3;

/** Channel spread below which a mark counts as monochrome — a black/gray/white
 *  wordmark, the kind brands invert wholesale. Measured on the raw channels
 *  rather than HSL saturation, which reads a near-black like niconico's
 *  #231815 as 25% saturated off a 14/255 spread. */
const MONO_SPREAD = 0.12;

type Rgb = [number, number, number];
type Hsl = [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

/** Snap to the 8-bit values a hex can actually express, so a color is measured
 *  as the one that ends up painted. */
function quantize(rgb: Rgb): Rgb {
  return rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255) / 255) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${quantize(rgb)
    .map((c) => (c * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1–21. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const seg = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((seg % 2) - 1));
  const [r, g, b]: Rgb =
    seg < 1 ? [c, x, 0]
    : seg < 2 ? [x, c, 0]
    : seg < 3 ? [0, c, x]
    : seg < 4 ? [0, x, c]
    : seg < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

const cache = new Map<string, string>();

/** The color a brand mark is painted in on the dark card, from its simple-icons
 *  hex (no leading `#`). The brand hex itself when that already reads there,
 *  else the nearest lightness that clears [`FLOOR`], hue and saturation
 *  untouched. A monochrome mark is mirrored across mid lightness first — the
 *  inversion the brand itself publishes (#000 → #fff). */
export function brandMarkDark(hex: string): string {
  const hit = cache.get(hex);
  if (hit) return hit;

  const rgb = parseHex(hex);
  const bg = parseHex(CARD_DARK);
  const [h, s, l0] = toHsl(rgb);
  const spread = Math.max(...rgb) - Math.min(...rgb);
  let l = spread <= MONO_SPREAD && l0 < 0.5 ? 1 - l0 : l0;

  let out = quantize(fromHsl([h, s, l]));
  while (contrast(out, bg) < FLOOR && l < 1) {
    l = Math.min(1, l + 0.01);
    out = quantize(fromHsl([h, s, l]));
  }

  const result = toHex(out);
  cache.set(hex, result);
  return result;
}
