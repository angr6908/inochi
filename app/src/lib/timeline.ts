export interface LocalTime {
  key: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string | undefined): Intl.DateTimeFormat {
  const id = tz ?? "";
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(id, f);
  }
  return f;
}

function parseTimestamp(date: string): number {
  return new Date(date.replace(" ", "T") + "Z").getTime();
}

export function localTime(date: string | number, tz: string | undefined): LocalTime {
  const ms = typeof date === "number" ? date : parseTimestamp(date);
  const o: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    key: `${o.year}-${o.month}-${o.day}`,
    year: Number(o.year),
    month: Number(o.month) - 1,
    day: Number(o.day),
    hour: Number(o.hour),
    minute: Number(o.minute),
  };
}

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function clockLabel(t: LocalTime): string {
  return `${pad(t.hour)}:${pad(t.minute)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

export function monthDay(t: LocalTime): string {
  return `${MONTHS[t.month]} ${t.day}`;
}

export function relativeDay(
  t: LocalTime,
  nowMs: number,
  tz: string | undefined,
): { label: string; year: number | null } {
  const now = localTime(nowMs, tz);
  if (t.key === now.key) return { label: "Today", year: null };
  if (t.key === localTime(nowMs - DAY_MS, tz).key) return { label: "Yesterday", year: null };
  return { label: monthDay(t), year: t.year === now.year ? null : t.year };
}
