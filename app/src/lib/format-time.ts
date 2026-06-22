// Must stay dependency-free (no imports/outer refs): it is serialized via
// .toString() into the pre-paint inline script in the root layout.
export function formatTimestamp(dateStr: string, tz: string | undefined, nowMs: number): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const then = new Date(dateStr.replace(" ", "T") + "Z").getTime();
  const diffMs = nowMs - then;
  const diffMin = diffMs / 60000;
  if (diffMin < 12 * 60) {
    if (diffMin < 1) return Math.max(0, Math.floor(diffMs / 1000)) + "s";
    if (diffMin < 60) return Math.floor(diffMin) + "m";
    return Math.floor(diffMin / 60) + "h";
  }
  const parts = (ms: number) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { year: +o.year, month: +o.month - 1, day: +o.day, hour: +o.hour, minute: +o.minute };
  };
  const same = (a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }) =>
    a.year === b.year && a.month === b.month && a.day === b.day;
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
  const tp = parts(then);
  const np = parts(nowMs);
  const hhmm = pad(tp.hour) + ":" + pad(tp.minute);
  const monDay = MONTHS[tp.month] + " " + tp.day;
  if (same(tp, np)) return hhmm;
  const yp = parts(nowMs - 86400000);
  if (same(tp, yp)) return "Yesterday " + hhmm;
  if (tp.year === np.year) return monDay + " " + hhmm;
  return tp.year + " " + monDay + " " + hhmm;
}
