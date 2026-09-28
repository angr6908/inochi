const preloaded = new Set<string>();
const loading = new Set<string>();
let stages: string[][] = [];

const PRELOAD_WINDOW = 2;

// A detached `new Image()` with no live reference can be garbage-collected
// while its request is still in flight; when it shares a resource with a visible
// `<img>`, that GC drops the decoded bitmap and forces the on-screen image to
// re-decode — a flicker. Hold each preloader until it settles, then release it.
const inflight = new Set<HTMLImageElement>();

function preload(url: string, onSettle: () => void) {
  const img = new Image();
  img.setAttribute("fetchpriority", "low");
  inflight.add(img);
  const done = () => {
    inflight.delete(img);
    preloaded.add(url);
    onSettle();
  };
  img.onload = done;
  img.onerror = done;
  img.src = url;
}

function pumpPreload() {
  while (stages.length > 0) {
    const stage = stages[0];
    while (stage.length > 0 && loading.size < PRELOAD_WINDOW) {
      const url = stage.shift()!;
      if (preloaded.has(url) || loading.has(url)) continue;
      loading.add(url);
      preload(url, () => {
        loading.delete(url);
        pumpPreload();
      });
    }
    if (stage.length > 0 || loading.size > 0) return;
    stages.shift();
  }
}

export type ImagePriority = "high" | "eager";

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
  if (pending.length === 0) {
    whenIdle(run);
    return;
  }
  let left = pending.length;
  const settle = () => {
    left -= 1;
    if (left === 0) afterVisibleImages(run);
  };
  for (const img of pending) {
    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
  }
}

function currentPageImageUrls(): string[] {
  return [...document.querySelectorAll<HTMLImageElement>("main img")]
    .filter((img) => img.src && !img.complete && img.getClientRects().length > 0)
    .map((img) => img.src);
}

let nextPageImageUrls: () => string[] = () => [];
let prefetchGeneration = 0;
let prefetchReady = false;

function queuePrefetch() {
  stages = [currentPageImageUrls(), nextPageImageUrls().map((url) => new URL(url, document.baseURI).href)];
  pumpPreload();
}

export function prefetchImages(nextPage: () => string[]) {
  if (typeof window === "undefined") return;
  stages = [];
  nextPageImageUrls = nextPage;
  prefetchReady = false;
  const generation = ++prefetchGeneration;
  afterVisibleImages(() => {
    if (generation !== prefetchGeneration) return;
    prefetchReady = true;
    queuePrefetch();
  });
}

export function refreshPrefetch() {
  if (prefetchReady) queuePrefetch();
}
