const preloaded = new Set<string>();
const preloadQueue: string[] = [];
const drainCallbacks: Array<() => void> = [];
let preloading = false;

function pumpPreload() {
  if (preloading) return;
  let url = preloadQueue.shift();
  while (url && preloaded.has(url)) url = preloadQueue.shift();
  if (!url) {
    if (drainCallbacks.length) drainCallbacks.splice(0).forEach((cb) => cb());
    return;
  }
  const target = url;
  preloading = true;
  const img = new Image();
  img.setAttribute("fetchpriority", "low");
  const done = () => {
    preloaded.add(target);
    preloading = false;
    pumpPreload();
  };
  img.onload = done;
  img.onerror = done;
  img.src = target;
}

export function preloadHigh(url: string) {
  if (preloaded.has(url)) return;
  preloaded.add(url);
  const img = new Image();
  img.setAttribute("fetchpriority", "high");
  img.src = url;
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
