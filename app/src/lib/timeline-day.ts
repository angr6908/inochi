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
