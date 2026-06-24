"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const iconButton =
  "absolute z-10 flex items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus:outline-none focus-visible:outline-none cursor-pointer";

const navButton = `${iconButton} top-1/2 -translate-y-1/2 size-7`;

type GalleryImg = { id: string; url: string; width: number | null; height: number | null };

const MAX_SINGLE_HEIGHT = 400;

function GalleryImage({
  image,
  mode,
  priority,
  onClick,
}: {
  image: GalleryImg;
  mode: "single" | "justified";
  priority?: boolean;
  onClick?: () => void;
}) {
  const [src, setSrc] = useState(image.url);
  const retried = useRef(false);

  // Reserve the image's box from its known ratio so layout never shifts while
  // loading. A "justified" image fills the width its flex column was given and
  // derives height from the ratio — within a row every image resolves to the
  // same height. A "single" image is sized to its natural dimensions, capped to
  // MAX_SINGLE_HEIGHT.
  const sized = image.width != null && image.height != null;
  const style: CSSProperties | undefined = !sized
    ? undefined
    : mode === "single"
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
      loading="eager"
      fetchPriority={priority ? "high" : "low"}
      decoding={priority ? "sync" : "async"}
      style={style}
      onClick={onClick}
      onError={() => {
        if (!retried.current) {
          retried.current = true;
          setSrc(`${image.url}${image.url.includes("?") ? "&" : "?"}retry=1`);
        }
      }}
      className={cn(
        "block cursor-pointer rounded-md border bg-muted",
        mode === "single"
          ? sized ? "mx-auto" : "mx-auto max-h-[400px] max-w-full"
          : "h-auto w-full",
      )}
    />
  );
}

// Aspect ratio used to size a justified row; falls back to square when unknown.
const aspectRatio = (img: GalleryImg) =>
  img.width && img.height ? img.width / img.height : 1;

export function ImageGallery({ images, priority }: { images: GalleryImg[]; priority?: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  const many = images.length > 1;

  useEffect(() => {
    if (!open || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      setSelected((s) => (s + dir + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, many, images.length]);

  if (images.length === 0) return null;

  const single = images.length === 1;
  const current = images[selected] ?? images[0];
  const go = (dir: number) => setSelected((s) => (s + dir + images.length) % images.length);

  const openAt = (i: number) => () => {
    setSelected(i);
    setOpen(true);
  };

  // Lay images out in rows of two. Within a justified row each image grows in
  // proportion to its aspect ratio (flex-basis: 0), so they all resolve to one
  // shared height with no cropping. A lone trailing image renders capped, like
  // a single image, rather than stretching full width.
  const rows: GalleryImg[][] = [];
  for (let i = 0; i < images.length; i += 2) rows.push(images.slice(i, i + 2));

  return (
    <>
      {single ? (
        <div className="mt-2">
          <GalleryImage image={images[0]} mode="single" priority={priority} onClick={openAt(0)} />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {rows.map((row, r) =>
            row.length === 1 ? (
              <GalleryImage
                key={row[0].id}
                image={row[0]}
                mode="single"
                priority={priority}
                onClick={openAt(r * 2)}
              />
            ) : (
              <div key={r} className="flex gap-1">
                {row.map((img, c) => (
                  <div
                    key={img.id}
                    className="min-w-0"
                    style={{ flexGrow: aspectRatio(img), flexBasis: 0 }}
                  >
                    <GalleryImage
                      image={img}
                      mode="justified"
                      priority={priority}
                      onClick={openAt(r * 2 + c)}
                    />
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-sm"
          className="flex w-fit max-w-[95vw] flex-col items-center gap-3 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[95vw]"
        >
          <DialogTitle className="sr-only">Image viewer</DialogTitle>

          <div className="relative mx-auto w-fit max-w-full justify-self-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt=""
              decoding="async"
              className="max-h-[80vh] w-auto max-w-[95vw] rounded-md object-contain"
            />

            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className={`${iconButton} top-2 right-2 size-7`}
            >
              <X className="size-4" />
            </button>

            {many && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous image"
                  className={`${navButton} left-2`}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next image"
                  className={`${navButton} right-2`}
                >
                  <ChevronRight className="size-4" />
                </button>
              </>
            )}
          </div>

          {many && (
            <div
              onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
              className="flex w-full max-w-[95vw] flex-wrap justify-center gap-2">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-label={`View image ${i + 1}`}
                  aria-current={i === selected}
                  className={`size-14 shrink-0 cursor-pointer overflow-hidden rounded-md transition-all focus-visible:outline-none ${
                    i === selected
                      ? "opacity-100 ring-2 ring-white"
                      : "opacity-50 ring-1 ring-white/20 hover:opacity-90"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" decoding="async" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
