// Jump to the top instantly, then re-pin on the next frame after layout settles.
// `behavior: "instant"` overrides the global `scroll-behavior: smooth` per call,
// so the jump is immediate rather than an animated scroll — otherwise the page
// glides up over a few hundred ms while the new page swaps in, and anything keyed
// off scroll position (e.g. the nav hairline) lags behind the animation.
export function scrollToTop() {
  if (typeof window === "undefined") return;
  const jump = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  jump();
  requestAnimationFrame(jump);
}
