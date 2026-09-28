import { useEffect } from "react";
import { measureTimelineDay, setTimelineDay, updateTimelineMotion } from "@/lib/timeline-day";

export function useTimelineTracking(content: unknown) {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          measureTimelineDay();
          updateTimelineMotion();
        });
      }
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      setTimelineDay(null);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      measureTimelineDay();
      updateTimelineMotion();
    });
    return () => cancelAnimationFrame(frame);
  }, [content]);
}
