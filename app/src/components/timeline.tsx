"use client";

import { useState } from "react";
import { CornerLeftDown } from "lucide-react";
import { useTz } from "@/lib/tz";
import { clockLabel, localTime, monthDay, type LocalTime } from "@/lib/timeline";
import { cn } from "@/lib/utils";

function DateMark({ t, className }: { t: LocalTime; className?: string }) {
  const [month, day] = monthDay(t).split(" ");
  return (
    <span className={cn("flex flex-col self-stretch", className)}>
      <span className="flex justify-between gap-1 text-[0.8rem] font-semibold whitespace-nowrap text-foreground">
        <span>{month}</span>{" "}
        <span>{day}</span>
      </span>
      <span aria-hidden className="mt-1 mb-0.5 h-px bg-border" />
    </span>
  );
}

export function TimelineDate({ date }: { date: string }) {
  const tz = useTz();
  return (
    <div className="pointer-events-none absolute top-0 bottom-2 left-0 z-10 w-[46px]">
      <div data-timeline-date className="sticky top-14 -mt-2 flex flex-col bg-background pt-2 text-xs leading-4 tabular-nums">
        <DateMark t={localTime(date, tz)} />
      </div>
    </div>
  );
}

export function TimelineTime({ date, dayStart }: { date: string; dayStart: boolean }) {
  const tz = useTz();
  const [now] = useState(() => Date.now());
  const t = localTime(date, tz);
  const otherYear = t.year !== localTime(now, tz).year;
  return (
    <time
      dateTime={date}
      suppressHydrationWarning
      className="mr-1 flex w-[46px] shrink-0 flex-col items-end text-right text-xs leading-4 text-muted-foreground tabular-nums"
    >
      {dayStart && <DateMark t={t} className="invisible" />}
      <span data-timeline-clock className="whitespace-nowrap">{clockLabel(t)}</span>
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
