"use client";

import { useState } from "react";
import { CornerLeftDown } from "lucide-react";
import { useTz } from "@/lib/tz";
import { clockLabel, localTime, monthDay } from "@/lib/timeline";
import { cn } from "@/lib/utils";

export function TimelineTime({ date, dayStart }: { date: string; dayStart: boolean }) {
  const tz = useTz();
  const [now] = useState(() => Date.now());
  const t = localTime(date, tz);
  const otherYear = t.year !== localTime(now, tz).year;
  const [month, day] = monthDay(t).split(" ");
  return (
    <time
      dateTime={date}
      suppressHydrationWarning
      className="mr-1 flex w-[46px] shrink-0 flex-col items-end text-right text-xs leading-4 text-muted-foreground tabular-nums"
    >
      {dayStart && (
        <span className="flex flex-col self-stretch">
          <span className="flex justify-between text-[0.8rem] font-semibold whitespace-nowrap text-foreground">
            <span>{month}</span>{" "}
            <span>{day}</span>
          </span>
          <span aria-hidden className="mt-1 mb-0.5 h-px bg-border" />
        </span>
      )}
      <span className="whitespace-nowrap">{clockLabel(t)}</span>
      {dayStart && otherYear && <span>{t.year}</span>}
    </time>
  );
}

export function EchoLabel({
  gap,
  author,
  onJump,
}: {
  gap: string;
  author?: string;
  onJump?: () => void;
}) {
  const content = (
    <>
      <CornerLeftDown className="size-3.5 shrink-0 text-primary" />
      <span className="font-medium text-primary">Echo</span>
      {author && (
        <span className="min-w-0 truncate">
          of <span className="font-medium text-foreground">{author}</span>
        </span>
      )}
      <span aria-hidden className="size-[2px] shrink-0 bg-muted-foreground/50" />
      <span className="shrink-0 whitespace-nowrap">{gap} later</span>
    </>
  );
  const base = "inline-flex min-w-0 items-center gap-1.5 text-xs leading-none text-muted-foreground";
  if (!onJump) return <span className={base}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onJump}
      title="Jump to the echoed post"
      className={cn(base, "-my-1 cursor-pointer rounded-sm py-1 transition-colors hover:text-foreground")}
    >
      {content}
    </button>
  );
}
