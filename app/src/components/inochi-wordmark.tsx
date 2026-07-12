import Image from "next/image";
import { INOCHI_CANDLE_AVIF } from "@/generated/inochi-candle";
import { cn } from "@/lib/utils";

export function InochiWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="inochi"
      className={cn(
        "inline-flex items-baseline whitespace-nowrap font-semibold tracking-tight",
        className,
      )}
      role="img"
      style={{ fontFamily: "var(--font-heading)" }}
    >
      <span aria-hidden="true" className="relative inline-block h-[1em] w-[0.244em]">
        <Image
          src={INOCHI_CANDLE_AVIF}
          alt=""
          fill
          unoptimized
          loading="eager"
          fetchPriority="high"
          decoding="sync"
        />
      </span>
      <span aria-hidden="true">nochi</span>
    </span>
  );
}
