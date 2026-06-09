"use client";

import { useState, useEffect } from "react";
import { Play, ExternalLink } from "lucide-react";
import { LinkPreview } from "@/lib/api";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type Embed = { src: string; title: string };

/** Build an inline player URL for embeddable providers, else null. */
function getEmbed(url: string): Embed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  const parent =
    typeof window !== "undefined" ? window.location.hostname : "localhost";

  // YouTube — watch?v=, youtu.be/, /embed/, /shorts/, /live/
  if (host.includes("youtube.com") || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] || null;
    else if (u.searchParams.get("v")) id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (m) id = m[1];
    }
    if (id)
      return {
        src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
        title: "YouTube video player",
      };
  }

  // Twitch — channel (live), VOD, or clip
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const parts = u.pathname.split("/").filter(Boolean);
    if (host.startsWith("clips.") && parts[0])
      return {
        src: `https://clips.twitch.tv/embed?clip=${parts[0]}&parent=${parent}&autoplay=true`,
        title: "Twitch clip",
      };
    if (parts[0] === "videos" && parts[1])
      return {
        src: `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}&autoplay=true`,
        title: "Twitch video",
      };
    if (parts[1] === "clip" && parts[2])
      return {
        src: `https://clips.twitch.tv/embed?clip=${parts[2]}&parent=${parent}&autoplay=true`,
        title: "Twitch clip",
      };
    if (parts[0] && !["directory", "settings", "p"].includes(parts[0]))
      return {
        src: `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}&autoplay=true`,
        title: "Twitch stream",
      };
  }

  // Vimeo
  if (host.includes("vimeo.com")) {
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m)
      return {
        src: `https://player.vimeo.com/video/${m[1]}?autoplay=1`,
        title: "Vimeo video player",
      };
  }

  return null;
}

export function LinkPreviewCard({ preview, priority }: { preview: LinkPreview; priority?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [thumbFit, setThumbFit] = useState<"cover" | "contain" | null>(null);
  // Only fade thumbnails that actually had to download. A cached image is
  // already decoded when its <img> first commits, so `measureThumb` reveals it
  // (opacity-100) in that same pre-paint commit — while the fade is still off —
  // and it snaps in instantly. Arming on the next frame means only thumbnails
  // still loading by then animate in, instead of every cached card flashing.
  const [fadeArmed, setFadeArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFadeArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const image = preview.thumbnail ?? preview.image_url;
  const visible = !!(preview.title || preview.description || preview.author);

  if (!visible) return null;

  const host = hostOf(preview.url);
  const site = preview.site_name ?? host;
  const embed = getEmbed(preview.url);
  const isYoutube = embed?.title === "YouTube video player";

  const measureThumb = (el: HTMLImageElement | null) => {
    if (!el || !el.complete || !el.naturalHeight) return;
    const ratio = el.naturalWidth / el.naturalHeight;
    setThumbFit(isYoutube && ratio > 1.25 && ratio < 1.45 ? "cover" : "contain");
  };

  const media = (() => {
    if (playing && embed) {
      return (
        <div className="relative aspect-video w-full bg-black">
          <iframe
            src={embed.src}
            title={embed.title}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      );
    }

    if (!image && !embed) return null;

    if (embed) {
      return (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play — ${preview.title ?? site}`}
          className="relative block aspect-video w-full overflow-hidden bg-muted"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={preview.title ?? ""}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
              ref={measureThumb}
              onLoad={(e) => measureThumb(e.currentTarget)}
              className={cn(
                "h-full w-full",
                fadeArmed && "transition-opacity duration-200",
                thumbFit === "cover" ? "object-cover" : "object-contain",
                thumbFit ? "opacity-100" : "opacity-0",
              )}
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="pointer-events-auto flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-md transition-colors duration-200 hover:bg-black/70">
              <Play className="h-[18px] w-[18px] translate-x-[1px] fill-current drop-shadow" />
            </span>
          </span>
        </button>
      );
    }

    return (
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-muted"
      >
        {/* Reserve the OpenGraph-standard 1.91:1 box up front (via aspect-ratio,
            which applies before the resource loads) so the card doesn't grow and
            shove the content below it down once the image arrives. object-contain
            keeps off-ratio images uncropped, letterboxed against the muted card. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image ?? undefined}
          alt={preview.title ?? ""}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          className="aspect-[1.91/1] w-full object-contain"
        />
      </a>
    );
  })();

  return (
    <div
      className={cn(
        "group mt-2 overflow-hidden rounded-xl border border-border bg-card",
        "transition-colors hover:bg-accent/40"
      )}
    >
      {media}

      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("flex flex-col gap-1 p-3", media && "border-t border-border")}
      >
        {/* Site name */}
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{site}</span>
        </div>

        {/* Title (for x.com this is the tweet content) */}
        {preview.title && (
          <p className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
            {preview.title}
          </p>
        )}

        {/* Channel / creator / author */}
        {preview.author && (
          <p className="truncate text-sm text-muted-foreground">
            By <span className="font-medium">{preview.author}</span>
          </p>
        )}
      </a>
    </div>
  );
}
