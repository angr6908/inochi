"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import {
  siYoutube, siTwitch, siX, siGithub, siGitlab, siReddit, siVimeo,
  siSpotify, siSoundcloud, siTiktok, siInstagram, siFacebook, siDiscord,
  siMedium, siSubstack, siBilibili, siNiconico, siSteam, siBandcamp,
  siPatreon, siThreads, siBluesky, siMastodon, siWikipedia, siApplemusic,
  siApplepodcasts, siPinterest, siTumblr, siSnapchat, siNetflix,
  siYcombinator, siNotion, siStackoverflow, siWordpress, siDailymotion,
  siKick, siRumble, siOdysee, siImdb, siDropbox, siFigma, siNpm,
  siHuggingface, siArxiv, siPixiv,
} from "simple-icons";
import { LinkPreview } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useImageReveal } from "@/lib/use-image-reveal";

function PreviewThumb({
  src,
  alt,
  priority,
  className,
}: {
  src?: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const { onMount, onReveal, revealClass } = useImageReveal();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      ref={onMount}
      onLoad={onReveal}
      className={cn(className, revealClass)}
    />
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type EmbedProvider = "youtube" | "twitch";
type Embed = { src: string; title: string; provider: EmbedProvider };

const iframeAllow =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";

// The embedded player paints its own page background (black) behind the video.
// The wrapper is an exact 16:9 box, but the iframe's fractional dimensions and
// the player's own internal layout round to device pixels independently, and
// that mismatch leaves a 1px black seam on one edge. Which edge differs by
// browser (Safari: left/right, Chrome: top/bottom). The player is a
// cross-origin document, so the seam can't be removed by styling its contents.
// Instead we grow the iframe a few pixels past the box on every side and clip
// the overflow, so the seam always lands in the clipped margin and never shows.
// The clipped bleed crops only a sub-percent sliver of video. We grow it with
// plain width/height, NOT `transform: scale()`: Twitch gates autoplay on the
// player's rendered "style visibility" and treats a scaled iframe as failing
// that check, so a scaled player loads but never starts.
const BLEED_PX = 2;

// --- Space-to-pause --------------------------------------------------------
// While an inline player is open, Space should control its playback instead of
// scrolling the feed — the behavior a focused media player gives you, extended
// to the whole document so it works without first clicking into the iframe.
//
// The player is a cross-origin document we can't call into directly. For
// YouTube we drive it through the IFrame Player API over postMessage (the embed
// URL carries `enablejsapi=1`); `activeYouTube` is the most recently started
// YouTube player, the one Space targets when several share the page. Twitch's
// raw player iframe has no supported postMessage control, so EmbedPlayer focuses
// it on load and lets the player's own Space handler take over — it never
// registers here.

type YouTubeControl = { toggle: () => void };

let activeYouTube: YouTubeControl | null = null;
let spaceListenerAttached = false;

// Elements that already do something with Space (form fields, buttons,
// editable text). When one of these is focused we leave Space alone so we don't
// swallow a button activation or a space typed into a field.
function consumesSpace(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY", "OPTION"].includes(el.tagName))
    return true;
  const role = el.getAttribute("role");
  return !!role && ["button", "checkbox", "switch", "menuitem", "tab", "radio"].includes(role);
}

function onSpaceKeydown(e: KeyboardEvent) {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!activeYouTube || consumesSpace(e.target)) return;
  // Reaching here means focus is on our page (when the iframe itself holds
  // focus YouTube handles Space and the event never crosses into this document)
  // and the page would otherwise scroll — so take over.
  e.preventDefault();
  activeYouTube.toggle();
}

function registerYouTube(control: YouTubeControl) {
  activeYouTube = control;
  if (!spaceListenerAttached) {
    window.addEventListener("keydown", onSpaceKeydown);
    spaceListenerAttached = true;
  }
}

function unregisterYouTube(control: YouTubeControl) {
  if (activeYouTube === control) activeYouTube = null;
}

function EmbedPlayer({ embed }: { embed: Embed }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (embed.provider !== "youtube") {
      // No postMessage control for the Twitch player, so move keyboard focus
      // into it once it loads: its native Space-to-pause then works and the page
      // no longer scrolls. preventScroll keeps the focus from yanking the feed.
      const onLoad = () => iframe.focus({ preventScroll: true });
      iframe.addEventListener("load", onLoad);
      return () => iframe.removeEventListener("load", onLoad);
    }

    const command = (func: string) =>
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args: "" }),
        "*",
      );

    // Mirror the player's real state so the toggle stays correct even after the
    // viewer pauses/plays with the player's own controls. autoplay=1 means it
    // starts playing; the state feed below corrects this if autoplay is blocked.
    let playing = true;
    const toggle = () => {
      command(playing ? "pauseVideo" : "playVideo");
      playing = !playing;
    };

    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || typeof e.data !== "string") return;
      let data: { info?: number | { playerState?: number } };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      // `onStateChange` delivers the state as a bare number, `infoDelivery`
      // nests it under `info.playerState`. 1 = playing, 3 = buffering (about to
      // play) — both mean the next Space should pause.
      const info = data.info;
      const state = typeof info === "number" ? info : info?.playerState;
      if (typeof state === "number") playing = state === 1 || state === 3;
    };
    window.addEventListener("message", onMessage);

    // The IFrame API only starts emitting state events after this handshake.
    const onLoad = () =>
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: 1 }),
        "*",
      );
    iframe.addEventListener("load", onLoad);

    const control: YouTubeControl = { toggle };
    registerYouTube(control);

    return () => {
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      unregisterYouTube(control);
    };
  }, [embed.provider]);

  return (
    // `clip-path` rounds the player's top corners to match the card. The card's
    // own `overflow-hidden rounded-xl` can't: Chrome won't apply a rounded
    // ancestor clip across into YouTube's hardware-accelerated player layer, so
    // its square black corners poke through. A `clip-path` mask on the wrapper
    // clips that layer directly. The radius is the card's outer radius minus its
    // 1px border (this wrapper sits just inside that border), tracking
    // `--radius-xl` rather than hardcoding a pixel value.
    <div
      className="relative aspect-video w-full overflow-hidden bg-transparent"
      style={{
        clipPath:
          "inset(0 round calc(var(--radius-xl) - 1px) calc(var(--radius-xl) - 1px) 0 0)",
      }}
    >
      <iframe
        ref={iframeRef}
        src={embed.src}
        title={embed.title}
        style={{
          top: -BLEED_PX,
          left: -BLEED_PX,
          width: `calc(100% + ${BLEED_PX * 2}px)`,
          height: `calc(100% + ${BLEED_PX * 2}px)`,
        }}
        className="absolute block border-0 bg-transparent"
        allow={iframeAllow}
        allowFullScreen
      />
    </div>
  );
}

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
      // Embed youtube.com, NOT youtube-nocookie.com. Safari grants unmuted
      // autoplay per-origin from the viewer's media-engagement history, which
      // they build on youtube.com — a nocookie embed is a separate origin with
      // no engagement, so Safari refuses to autoplay it. Plain autoplay (no
      // mute) then plays with sound where allowed (Chrome, engaged Safari).
      return {
        // `enablejsapi=1` lets us drive the player over postMessage (the IFrame
        // Player API) so Space can pause/resume it — see EmbedPlayer.
        src: `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&enablejsapi=1`,
        title: "YouTube video player",
        provider: "youtube",
      };
  }

  // Twitch — channel (live), VOD, or clip
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const parts = u.pathname.split("/").filter(Boolean);
    // Twitch force-mutes autoplay for embedded clips regardless of any `muted`
    // param (a clip's audio can only be enabled by the viewer via the player's
    // own unmute control), so we don't bother trying to override it.
    if (host.startsWith("clips.") && parts[0])
      return {
        src: `https://clips.twitch.tv/embed?clip=${parts[0]}&parent=${parent}&autoplay=true`,
        title: "Twitch clip",
        provider: "twitch",
      };
    if (parts[0] === "videos" && parts[1])
      return {
        src: `https://player.twitch.tv/?video=${parts[1]}&parent=${parent}&autoplay=true`,
        title: "Twitch video",
        provider: "twitch",
      };
    if (parts[1] === "clip" && parts[2])
      return {
        src: `https://clips.twitch.tv/embed?clip=${parts[2]}&parent=${parent}&autoplay=true`,
        title: "Twitch clip",
        provider: "twitch",
      };
    if (parts[0] && !["directory", "settings", "p"].includes(parts[0]))
      return {
        src: `https://player.twitch.tv/?channel=${parts[0]}&parent=${parent}&autoplay=true`,
        title: "Twitch stream",
        provider: "twitch",
      };
  }

  return null;
}

// The footer marks the source with the site's real brand icon (simple-icons)
// instead of its domain name. Icons are keyed by the domain's brand label — the
// segment before the TLD — so subdomains resolve too (clips.twitch.tv → twitch,
// open.spotify.com → spotify, news.ycombinator.com → ycombinator). Aliases cover
// brands whose label differs from their icon (youtu.be, twitter.com → x, …).
type BrandIcon = { title: string; hex: string; path: string };

const BRAND_BY_LABEL: Record<string, BrandIcon> = {
  youtube: siYoutube, youtu: siYoutube,
  twitch: siTwitch,
  x: siX, twitter: siX,
  github: siGithub, gitlab: siGitlab,
  reddit: siReddit, vimeo: siVimeo,
  spotify: siSpotify, soundcloud: siSoundcloud,
  tiktok: siTiktok, instagram: siInstagram,
  facebook: siFacebook, fb: siFacebook,
  discord: siDiscord, medium: siMedium, substack: siSubstack,
  bilibili: siBilibili, niconico: siNiconico, nicovideo: siNiconico,
  steam: siSteam, steampowered: siSteam,
  bandcamp: siBandcamp, patreon: siPatreon,
  threads: siThreads, bsky: siBluesky, bluesky: siBluesky,
  mastodon: siMastodon, wikipedia: siWikipedia,
  apple: siApplemusic,
  pinterest: siPinterest, tumblr: siTumblr, snapchat: siSnapchat,
  netflix: siNetflix, ycombinator: siYcombinator,
  notion: siNotion, stackoverflow: siStackoverflow, wordpress: siWordpress,
  dailymotion: siDailymotion, kick: siKick, rumble: siRumble,
  odysee: siOdysee, imdb: siImdb, dropbox: siDropbox, figma: siFigma,
  npmjs: siNpm, huggingface: siHuggingface, arxiv: siArxiv, pixiv: siPixiv,
};

function brandIconFor(host: string): BrandIcon | null {
  if (!host) return null;
  // Apple Music and Apple Podcasts share apple.com, so the label alone can't
  // tell them apart — disambiguate by subdomain before the generic lookup.
  if (host.endsWith("podcasts.apple.com")) return siApplepodcasts;
  const parts = host.split(".");
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return BRAND_BY_LABEL[label] ?? null;
}

// simple-icons each fill their 24×24 viewBox per the brand's own guidelines, so
// they aren't optically size-normalized against each other. This can't be fixed
// automatically from the bounding box: a filled circle (Spotify) and a sparse X
// both span the full box yet read as different sizes, so normalizing by bbox
// extent just shrinks every full-bleed mark. Optical size is a per-shape call —
// so we only nudge the rare outlier. X is the classic one (its angular mark
// reads large); add a brand here if another ever looks off. Keyed by icon title
// (twitter.com and x.com both resolve to "X").
const OPTICAL_SCALE: Record<string, number> = {
  X: 0.82,
};

// A simple-icons path rendered in the brand's own color (no hover transition).
function BrandMark({ icon, className }: { icon: BrandIcon; className?: string }) {
  const scale = OPTICAL_SCALE[icon.title] ?? 1;
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      aria-label={icon.title}
      style={{ fill: `#${icon.hex}` }}
      className={cn("size-3.5 shrink-0", className)}
    >
      <title>{icon.title}</title>
      <path
        d={icon.path}
        transform={scale === 1 ? undefined : `translate(12 12) scale(${scale}) translate(-12 -12)`}
      />
    </svg>
  );
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
  const brand = brandIconFor(host);
  const embed = getEmbed(preview.url);
  const isYoutube = embed?.provider === "youtube";

  const measureThumb = (el: HTMLImageElement | null) => {
    if (!el || !el.complete || !el.naturalHeight) return;
    const ratio = el.naturalWidth / el.naturalHeight;
    setThumbFit(isYoutube && ratio > 1.25 && ratio < 1.45 ? "cover" : "contain");
  };

  // Served URLs for a multi-photo preview (e.g. a tweet with several photos),
  // in order. Empty for the common single-image preview.
  const gridImages = (preview.images ?? [])
    .map((i) => i.thumbnail ?? i.image_url)
    .filter((src): src is string => !!src)
    .slice(0, 4);

  const media = (() => {
    if (playing && embed) {
      return <EmbedPlayer embed={embed} />;
    }

    if (!image && !embed) return null;

    // Two or more photos (X never embeds) — lay them out in a grid like the
    // source does, instead of showing only the first.
    if (gridImages.length >= 2 && !embed) {
      const n = gridImages.length;
      return (
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "grid aspect-video w-full grid-cols-2 gap-px overflow-hidden bg-border",
            n > 2 && "grid-rows-2",
          )}
        >
          {gridImages.map((src, idx) => (
            <PreviewThumb
              key={idx}
              src={src}
              alt={preview.title ?? ""}
              priority={priority}
              className={cn(
                "h-full w-full object-cover",
                // 3-up: the first photo fills the full-height left column.
                n === 3 && idx === 0 && "row-span-2",
              )}
            />
          ))}
        </a>
      );
    }

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
              decoding="async"
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
        className="block overflow-hidden bg-muted"
      >
        {/* Reserve a 16:9 box up front (via aspect-ratio, which applies before
            the resource loads) so the card doesn't grow and shove the content
            below it down once the image arrives. object-contain keeps off-ratio
            images uncropped, letterboxed against the muted card. */}
        <PreviewThumb
          src={image ?? undefined}
          alt={preview.title ?? ""}
          priority={priority}
          className="aspect-video w-full object-contain"
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
        {/* Title (for x.com this is the tweet content) */}
        {preview.title && (
          <p className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
            {preview.title}
          </p>
        )}

        {/* Footer row, left-aligned: the source site's brand logo leads
            (standing in for "By"), then the author. With no author the logo
            sits alone in this same spot rather than pinned to the right. An
            unmapped site falls back to the literal "By" before an author, or to
            the domain text on its own. */}
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {preview.author ? (
            <>
              {brand ? <BrandMark icon={brand} /> : <span className="shrink-0">By</span>}
              <span className="min-w-0 truncate font-medium">{preview.author}</span>
            </>
          ) : brand ? (
            <BrandMark icon={brand} />
          ) : (
            <span className="shrink-0 font-medium">{site}</span>
          )}
        </div>
      </a>
    </div>
  );
}
