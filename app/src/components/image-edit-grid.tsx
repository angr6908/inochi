"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

export interface EditableImage {
  /** Stable key for this tile. */
  id: string;
  /** Image source — a remote URL for an existing image, or a data URL for a
   *  newly-picked file. Empty while a freshly-picked file is still loading. */
  preview: string;
}

/**
 * A reorderable grid of image thumbnails with per-tile remove buttons. Drag a
 * tile (pointer-based, so it works on touch) to move it; the nearest tile under
 * the pointer is swapped in. Used by the post composer and the edit dialog.
 */
export function ImageEditGrid({
  images,
  onReorder,
  onRemove,
}: {
  images: EditableImage[];
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);

  const nearestIndex = (x: number, y: number) => {
    let best = 0;
    let bestDist = Infinity;
    tileRefs.current.forEach((el, idx) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(index);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragIndex === null) return;
    const target = nearestIndex(e.clientX, e.clientY);
    if (target !== dragIndex) {
      onReorder(dragIndex, target);
      setDragIndex(target);
    }
  };

  const endDrag = () => setDragIndex(null);

  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, i) => (
        <div
          key={img.id}
          ref={(el) => {
            tileRefs.current[i] = el;
          }}
          onPointerDown={(e) => handlePointerDown(e, i)}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`group relative touch-none select-none transition-transform ${
            dragIndex === i ? "scale-105 cursor-grabbing opacity-60 shadow-lg" : "cursor-grab"
          }`}
        >
          {img.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.preview}
              alt=""
              draggable={false}
              className="h-20 w-20 rounded-lg object-cover ring-1 ring-border"
            />
          ) : (
            <div className="h-20 w-20 animate-pulse rounded-lg bg-muted ring-1 ring-border" />
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label="Remove image"
            className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white shadow-sm ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:bg-black/75 focus-visible:outline-none"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
