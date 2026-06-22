const preloaded = new Set<string>();
const preloadQueue: string[] = [];
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
  while (url && preloaded.has(url)) url = preloadQueue.shift();
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
    if (!preloaded.has(url) && !preloadQueue.includes(url)) preloadQueue.push(url);
  }
  if (onDone) {
    if (preloadQueue.length === 0 && !preloading) onDone();
    else drainCallbacks.push(onDone);
  }
  pumpPreload();
}
