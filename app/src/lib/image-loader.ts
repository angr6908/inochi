const preloaded = new Set<string>();
const preloadQueue: string[] = [];
// Mirrors preloadQueue for membership tests: preloadImages is called with a
// whole page of urls at a time, and scanning the array for each one made that
// quadratic.
const queued = new Set<string>();
const drainCallbacks: Array<() => void> = [];
let preloading = false;

// A detached `new Image()` with no live reference can be garbage-collected
// while its request is still in flight; when it shares a resource with a visible
// `<img>`, that GC drops the decoded bitmap and forces the on-screen image to
// re-decode — a flicker. Hold each preloader until it settles, then release it.
const inflight = new Set<HTMLImageElement>();

function preload(url: string, priority: "high" | "low", onSettle?: () => void) {
  const img = new Image();
  img.setAttribute("fetchpriority", priority);
  inflight.add(img);
  const done = () => {
    inflight.delete(img);
    preloaded.add(url);
    onSettle?.();
  };
  img.onload = done;
  img.onerror = done;
  img.src = url;
}

function pumpPreload() {
  if (preloading) return;
  let url = preloadQueue.shift();
  if (url) queued.delete(url);
  while (url && preloaded.has(url)) {
    url = preloadQueue.shift();
    if (url) queued.delete(url);
  }
  if (!url) {
    if (drainCallbacks.length) drainCallbacks.splice(0).forEach((cb) => cb());
    return;
  }
  preloading = true;
  preload(url, "low", () => {
    preloading = false;
    pumpPreload();
  });
}

export function preloadHigh(...urls: string[]) {
  for (const url of urls) {
    if (preloaded.has(url)) continue;
    preloaded.add(url);
    preload(url, "high");
  }
}

export function preloadImages(urls: string[], onDone?: () => void) {
  for (const url of urls) {
    if (!preloaded.has(url) && !queued.has(url)) {
      preloadQueue.push(url);
      queued.add(url);
    }
  }
  if (onDone) {
    if (preloadQueue.length === 0 && !preloading) onDone();
    else drainCallbacks.push(onDone);
  }
  pumpPreload();
}

export type ImagePriority = "high" | "eager";

const PREFETCH_FALLBACK_MS = 8000;

function constrainedNetwork(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (!connection) return false;
  return connection.saveData === true || ["slow-2g", "2g", "3g"].includes(connection.effectiveType ?? "");
}

function whenIdle(run: () => void) {
  const w = window as typeof window & { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run);
  else setTimeout(run, 200);
}

function afterVisibleImages(run: () => void) {
  if (document.readyState !== "complete") {
    window.addEventListener("load", () => afterVisibleImages(run), { once: true });
    return;
  }
  const pending = [...document.querySelectorAll<HTMLImageElement>('main img[loading="eager"]')].filter(
    (img) => !img.complete && img.getClientRects().length > 0,
  );
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    whenIdle(run);
  };
  if (pending.length === 0) {
    fire();
    return;
  }
  let left = pending.length;
  const settle = () => {
    left -= 1;
    if (left === 0) fire();
  };
  for (const img of pending) {
    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
  }
  setTimeout(fire, PREFETCH_FALLBACK_MS);
}

export function prefetchImages(urls: string[]) {
  if (typeof window === "undefined" || urls.length === 0 || constrainedNetwork()) return;
  afterVisibleImages(() => preloadImages(urls));
}
