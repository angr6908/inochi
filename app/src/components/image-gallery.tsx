"use client";

import { useEffect, useState, type CSSProperties } from "react";
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
  mode: "single" | "justified" | "lone";
  priority?: boolean;
  onClick?: () => void;
}) {
  // `src` is seeded from the prop but then owned locally, because the error
  // handler retries through it. A changed url therefore has to be adopted
  // explicitly or the element keeps painting the previous image. Held as one
  // object so the url it was seeded from, what is displayed, and whether the
  // retry has been spent can never disagree.
  const [shown, setShown] = useState({ url: image.url, src: image.url, retried: false });
  if (shown.url !== image.url) {
    setShown({ url: image.url, src: image.url, retried: false });
  }

  // Reserve the image's box from its known ratio so layout never shifts while
  // loading. A "justified" image fills the width its flex column was given and
  // derives height from the ratio — within a row every image resolves to the
  // same height. A "single" image (the only image in a post) is sized to its
  // natural dimensions, capped to MAX_SINGLE_HEIGHT. A "lone" image is the odd
  // trailing one in a multi-image gallery (3, 5, 7…): it must not span the full
  // row, so its width is capped to half the container (and to MAX_SINGLE_HEIGHT
  // worth of width). All bounds are CSS-derived so the box is reserved before
  // the image loads — no flicker on load/refresh.
  const sized = image.width != null && image.height != null;
  const ratioWidthPx = sized ? Math.round(MAX_SINGLE_HEIGHT * (image.width! / image.height!)) : 0;
  const style: CSSProperties | undefined = !sized
    ? undefined
    : mode === "single"
      ? {
          aspectRatio: `${image.width} / ${image.height}`,
          width: Math.min(image.width!, ratioWidthPx),
          maxWidth: "100%",
        }
      : mode === "lone"
        ? {
            aspectRatio: `${image.width} / ${image.height}`,
            width: `min(50%, ${ratioWidthPx}px)`,
          }
        : { aspectRatio: `${image.width} / ${image.height}` };

  const img = (
    <img
      src={shown.src}
      alt=""
      // Mirror the link-preview thumbnails, which never flicker: decode
      // synchronously and lazy-load the off-screen ones. `decoding="async"` lets
      // the browser paint a non-priority image blank for a frame whenever it has
      // to re-decode (a client-side feed re-render / relayout) — that's the
      // flicker, and the first image escaped it only because `priority` made it
      // `sync`. `sync` forbids the blank; `lazy` stops that from decoding every
      // off-screen photo up front, so the sync cost is paid one image at a time
      // as it scrolls into view — exactly what the thumbnails do.
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="sync"
      style={style}
      onError={() => {
        if (shown.retried) return;
        setShown((s) => ({
          ...s,
          retried: true,
          src: `${image.url}${image.url.includes("?") ? "&" : "?"}retry=1`,
        }));
      }}
      className={cn(
        "block rounded-md border bg-muted",
        mode === "single"
          ? sized ? "" : "max-h-[400px] max-w-full"
          : mode === "lone"
            ? sized ? "" : "max-h-[400px] max-w-[50%]"
            : "h-auto w-full",
      )}
    />
  );

  if (!onClick) return img;

  // Wrapped in a real button rather than carrying `onClick` on the image: that
  // makes it tabbable and operable by Enter/Space without re-implementing
  // either. The button is a bare layout box — alignment only — so the image
  // keeps owning its reserved size and every mode lays out as before.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open image"
      className={cn(
        "block cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        mode === "single"
          ? "mx-auto max-w-full"
          : mode === "lone"
            ? "mr-auto max-w-full"
            : "w-full",
      )}
    >
      {img}
    </button>
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
        <div>
          <GalleryImage image={images[0]} mode="single" priority={priority} onClick={openAt(0)} />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((row, r) =>
            row.length === 1 ? (
              <GalleryImage
                key={row[0].id}
                image={row[0]}
                mode="lone"
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
        {/* Transform-free centering keeps enlarged images sharp in WebKit. */}
        <DialogContent
          showCloseButton={false}
          variant="bare"
          overlay="heavy"
          // `pointer-events-none` here (with `pointer-events-auto` on the
          // image and each thumbnail) lets a click on the empty space around
          // them reach the backdrop, which dismisses. That is the same "click
          // beside the picture to close" the strip used to emulate with a
          // target/currentTarget handler, minus the click handler on a div.
          className="pointer-events-none inset-0 m-auto flex h-fit w-fit max-w-[95vw] translate-none flex-col items-center sm:max-w-[95vw]"
        >
          <DialogTitle className="sr-only">Image viewer</DialogTitle>

          <div className="pointer-events-auto relative mx-auto w-fit max-w-full justify-self-center">
            <img
              src={current.url}
              alt=""
              width={current.width ?? undefined}
              height={current.height ?? undefined}
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
            <div className="flex w-full max-w-[95vw] flex-wrap justify-center gap-2">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-label={`View image ${i + 1}`}
                  aria-current={i === selected}
                  className={`pointer-events-auto size-14 shrink-0 cursor-pointer overflow-hidden rounded-md transition-all focus-visible:outline-none ${
                    i === selected
                      ? "opacity-100 ring-2 ring-white"
                      : "opacity-50 ring-1 ring-white/20 hover:opacity-90"
                  }`}
                >
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
