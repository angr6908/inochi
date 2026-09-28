const DOCK_LINE_PX = 56;

let current: string | null = null;
const listeners = new Set<() => void>();

export function subscribeTimelineDay(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTimelineDay(): string | null {
  return current;
}

export function setTimelineDay(date: string | null): void {
  if (date === current) return;
  current = date;
  for (const listener of listeners) listener();
}

export function measureTimelineDay(): void {
  let active: string | null = null;
  for (const el of document.querySelectorAll<HTMLElement>("[data-timeline-day]")) {
    const rect = (el.querySelector("article") ?? el).getBoundingClientRect();
    if (rect.height === 0) continue;
    if (rect.bottom > DOCK_LINE_PX) {
      active = el.dataset.timelineDay ?? null;
      break;
    }
  }
  setTimelineDay(active);
}

const DATE_FADE_PX = 24;
const CLOCK_FADE_PX = 12;

function setOpacity(el: HTMLElement, value: number): void {
  const next = value >= 1 ? "" : value.toFixed(3);
  if (el.style.opacity !== next) el.style.opacity = next;
}

export function updateTimelineMotion(): void {
  let line = -Infinity;
  for (const el of document.querySelectorAll<HTMLElement>("[data-timeline-date]")) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    setOpacity(el, 1 - Math.min(1, Math.max(0, DOCK_LINE_PX - rect.top) / DATE_FADE_PX));
    if (rect.top <= DOCK_LINE_PX + 0.5 && rect.bottom > DOCK_LINE_PX) line = Math.max(line, rect.bottom);
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-timeline-clock]")) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    setOpacity(el, 1 - Math.min(1, Math.max(0, line - rect.top) / CLOCK_FADE_PX));
  }
}
