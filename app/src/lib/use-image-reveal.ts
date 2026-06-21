import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function useImageReveal() {
  const [revealed, setRevealed] = useState(false);
  const [fadeArmed, setFadeArmed] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setFadeArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return {
    onMount: (el: HTMLImageElement | null) => {
      if (el?.complete && el.naturalHeight) setRevealed(true);
    },
    onReveal: () => setRevealed(true),
    revealClass: cn(
      fadeArmed && "transition-opacity duration-200",
      revealed ? "opacity-100" : "opacity-0",
    ),
  };
}
