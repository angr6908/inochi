"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

type GalleryImg = { id: string; url: string; width: number | null; height: number | null };

const MAX_SINGLE_HEIGHT = 400;

function GalleryImage({ image, single, priority }: { image: GalleryImg; single: boolean; priority?: boolean }) {
  const [src, setSrc] = useState(image.url);
  const retried = useRef(false);

  // Reserve the image's box so it never shifts layout while loading.
  // A grid cell fills its column and derives height from the ratio; a single
  // image is sized to its natural dimensions, capped to MAX_SINGLE_HEIGHT.
  const sized = image.width != null && image.height != null;
  const style: CSSProperties | undefined = !sized
    ? undefined
    : single
      ? {
          aspectRatio: `${image.width} / ${image.height}`,
          width: Math.min(image.width!, Math.round(MAX_SINGLE_HEIGHT * (image.width! / image.height!))),
          maxWidth: "100%",
        }
      : { aspectRatio: `${image.width} / ${image.height}` };

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      style={style}
      onError={() => {
        if (!retried.current) {
          retried.current = true;
          setSrc(`${image.url}${image.url.includes("?") ? "&" : "?"}retry=1`);
        }
      }}
      className={`block cursor-pointer rounded-md border bg-muted ${
        single
          ? sized ? "mx-auto" : "mx-auto max-h-[400px] max-w-full"
          : "h-auto w-full"
      }`}
    />
  );
}

export function ImageGallery({ images, priority }: { images: GalleryImg[]; priority?: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  if (images.length === 0) return null;

  const single = images.length === 1;

  return (
    <div className={`mt-2 grid gap-1 ${single ? "grid-cols-1" : "grid-cols-2"}`}>
      {images.map((img, i) => (
        <Dialog key={img.id} open={open && selected === i} onOpenChange={(o) => { setOpen(o); setSelected(i); }}>
          <DialogTrigger>
            <GalleryImage image={img} single={single} priority={priority} />
          </DialogTrigger>
          <DialogContent className="w-fit max-w-[95vw] border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[95vw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" decoding="async" className="max-h-[88vh] w-auto max-w-[95vw] rounded-md object-contain" />
          </DialogContent>
        </Dialog>
      ))}
    </div>
  );
}
