// Jump to the top instantly (overriding the global `scroll-behavior: smooth` so
// the page doesn't visibly scroll up while the new page swaps in), then re-pin
// on the next frame after layout settles.
export function scrollToTop() {
  if (typeof window === "undefined") return;
  const html = document.documentElement;
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    html.style.scrollBehavior = previous;
  });
}
