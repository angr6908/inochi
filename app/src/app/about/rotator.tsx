"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const RING_R = 8;
const RING_CIRC = 2 * Math.PI * RING_R;

interface Line {
  lang: string;
  font: string;
  content: ReactNode;
}

const LINES: Line[] = [
  {
    lang: "ja",
    font: "var(--font-noto-sans-jp)",
    content: (
      <>
        いかにして「<span className="text-primary">命</span>」という檻を
        <br />
        越えるのか。
      </>
    ),
  },
  {
    lang: "en",
    font: "var(--font-heading)",
    content: (
      <>
        How to escape from the prison of{" "}
        <span className="text-primary">existence</span>?
      </>
    ),
  },
  {
    lang: "zh-Hant",
    font: "var(--font-noto-sans-jp)",
    content: (
      <>
        作爲「存在」之産物的
        <span className="whitespace-nowrap text-primary">生命體</span>
        ，如何從時間的牢籠中逃離？
      </>
    ),
  },
];

const ROTATE_MS = 3500;

export function AboutRotator() {
  const [active, setActive] = useState(0);
  const [animated, setAnimated] = useState(false);
  const ringRef = useRef<SVGCircleElement | null>(null);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      setActive(Math.floor(Math.random() * LINES.length));
      raf2 = requestAnimationFrame(() => setAnimated(true));
    });
    const t = setInterval(
      () => setActive((n) => (n + 1) % LINES.length),
      ROTATE_MS,
    );
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const el = ringRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.style.strokeDashoffset = "0";
      return;
    }
    const anim = el.animate(
      [{ strokeDashoffset: `${RING_CIRC}` }, { strokeDashoffset: "0" }],
      { duration: ROTATE_MS, easing: "linear", fill: "forwards" },
    );
    return () => anim.cancel();
  }, [active]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="grid grid-cols-1 text-2xl font-semibold leading-snug tracking-tight">
        {LINES.map((line, i) => {
          const isActive = i === active;
          return (
            <span
              key={i}
              lang={line.lang}
              aria-hidden={!isActive}
              className={cn(
                "col-start-1 row-start-1 self-start text-center text-balance",
                animated &&
                  "transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] motion-reduce:transition-none",
                isActive
                  ? "opacity-100 scale-100 blur-0"
                  : "pointer-events-none opacity-0 scale-95 blur-[2px]",
              )}
              style={{ fontFamily: line.font }}
            >
              {line.content}
            </span>
          );
        })}
      </h1>

      <p className="text-base leading-relaxed text-muted-foreground text-balance">
        It may be the last and greatest jailbreak for all humankind.
      </p>

      <div
        className="flex justify-center text-primary/80"
        role="progressbar"
        aria-label="Time until next phrase"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          className="-rotate-90 overflow-visible"
          aria-hidden
        >
          <circle
            cx="10"
            cy="10"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            className="stroke-current opacity-15"
          />
          <circle
            ref={ringRef}
            cx="10"
            cy="10"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={RING_CIRC}
            className="stroke-current"
          />
        </svg>
      </div>
    </div>
  );
}
