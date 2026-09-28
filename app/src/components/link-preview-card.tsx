"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
import { previewHasText } from "@/lib/preview-text";
import type { ImagePriority } from "@/lib/image-loader";
import { brandMarkDark } from "@/lib/brand-color";
import { cn } from "@/lib/utils";

function PreviewThumb({
  src,
  alt,
  priority,
  className,
}: {
  src?: string;
  alt: string;
  priority?: ImagePriority;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority === "high" ? "high" : undefined}
      decoding="sync"
      className={className}
    />
  );
}

const COVER_MIN_RATIO = 1.3;

const THUMB_BOX =
  "relative block aspect-video w-[clamp(128px,30%,160px)] shrink-0 self-stretch overflow-hidden border-r border-border bg-muted";

function thumbFit(w?: number | null, h?: number | null): "object-cover" | "object-contain" {
  if (!w || !h || w <= 0 || h <= 0) return "object-cover";
  return w / h >= COVER_MIN_RATIO ? "object-cover" : "object-contain";
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

// Embeds are YouTube and Twitch players, which need scripts and their own
// origin (the YouTube IFrame API is driven over postMessage, and both set
// cookies for playback). What this withholds is the dangerous part:
// `allow-top-navigation` is absent, so a compromised embed cannot redirect the
// page out from under the reader, and forms, downloads and pointer lock are
// blocked too. `allow-same-origin` is same-origin to the *provider*, not to us.
const iframeSandbox =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";

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
        sandbox={iframeSandbox}
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

// A simple-icons path rendered in the brand's own color (no hover transition) —
// the brand hex as-is on the light card, and on the dark card the variant that
// reads there, the way the brand itself inverts a black mark (X, niconico,
// GitHub). Both colors ride along as custom properties, the dark one derived on
// the server (lib/brand-color); the `dark:` utility — a bare
// `prefers-color-scheme` media query, the same switch the rest of the theme
// uses — picks between them in the render-blocking stylesheet. So the choice is
// made before the first paint (no flash of the light mark on load or refresh,
// and no hydration mismatch: the HTML carries both), and changing the OS theme
// repaints it with no JS in the loop.
function BrandMark({ icon, className }: { icon: BrandIcon; className?: string }) {
  const scale = OPTICAL_SCALE[icon.title] ?? 1;
  return (
    <svg
      // The mark is an inline SVG because it is themed through CSS custom
      // properties, so it cannot be an <img>; role="img" + aria-label is the
      // canonical way to make one accessible.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
      role="img"
      viewBox="0 0 24 24"
      aria-label={icon.title}
      style={
        {
          "--brand-mark": `#${icon.hex}`,
          "--brand-mark-dark": brandMarkDark(icon.hex),
        } as CSSProperties
      }
      className={cn(
        "size-3.5 shrink-0 fill-(--brand-mark) dark:fill-(--brand-mark-dark)",
        className,
      )}
    >
      <title>{icon.title}</title>
      <path
        d={icon.path}
        transform={scale === 1 ? undefined : `translate(12 12) scale(${scale}) translate(-12 -12)`}
      />
    </svg>
  );
}

function PreviewSource({
  preview,
  brand,
  site,
  className,
}: {
  preview: LinkPreview;
  brand: BrandIcon | null;
  site: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
      {preview.author ? (
        <>
          {brand ? <BrandMark icon={brand} /> : <span className="shrink-0">By</span>}
          <span className="min-w-0 truncate font-medium">{preview.author}</span>
        </>
      ) : brand ? (
        <>
          <BrandMark icon={brand} />
          <span className="min-w-0 truncate font-medium">{site}</span>
        </>
      ) : (
        <span className="min-w-0 truncate font-medium">{site}</span>
      )}
    </div>
  );
}

function PreviewTags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="relative z-10 ml-auto flex shrink-0 divide-x divide-border self-end overflow-hidden rounded-tl-md border-t border-l border-border">
      {tags.map((tag) => (
        <Link
          key={tag}
          href={`/?tag=${tag}`}
          className="flex h-6 items-center bg-primary/10 px-2 font-sans text-xs leading-none font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          {tag}
        </Link>
      ))}
    </div>
  );
}

function TweetCard({
  preview,
  avatar,
  brand,
  tags,
  priority,
}: {
  preview: LinkPreview;
  avatar: string;
  brand: BrandIcon | null;
  tags?: string[];
  priority?: ImagePriority;
}) {
  const m = preview.author?.match(/^(.*?)\s*\((@[^)]+)\)\s*$/);
  const name = m ? m[1] : preview.author;
  const handle = m?.[2] ?? null;
  const text = preview.title ?? preview.description ?? null;
  const hasTags = !!tags && tags.length > 0;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40">
      <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-sm leading-tight">
        <PreviewThumb
          src={avatar}
          alt=""
          priority={priority}
          className="size-5 shrink-0 rounded-full bg-muted object-cover"
        />
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 truncate font-semibold text-foreground after:absolute after:inset-0"
        >
          {name}
        </a>
        {handle && <span className="min-w-0 truncate text-muted-foreground">{handle}</span>}
        {brand && <BrandMark icon={brand} className="ml-auto" />}
      </div>

      {(text || hasTags) && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-normal text-foreground">
          {text}
          {hasTags && (
            <span
              aria-hidden
              className="invisible ml-2 inline-flex divide-x divide-transparent border-l border-transparent font-sans text-xs leading-none font-medium"
            >
              {tags.map((tag) => (
                <span key={tag} className="px-2">
                  {tag}
                </span>
              ))}
            </span>
          )}
        </p>
      )}

      {hasTags && (
        <div className="absolute right-0 bottom-0 flex">
          <PreviewTags tags={tags} />
        </div>
      )}
    </div>
  );
}

export function LinkPreviewCard({
  preview,
  tags,
  priority,
}: {
  preview: LinkPreview;
  tags?: string[];
  priority?: ImagePriority;
}) {
  const [playing, setPlaying] = useState(false);
  const image = preview.thumbnail ?? preview.image_url;

  if (!previewHasText(preview)) return null;

  const host = hostOf(preview.url);
  const site = preview.site_name ?? host;
  const brand = brandIconFor(host);
  const embed = getEmbed(preview.url);
  const headline = preview.title ?? preview.description;

  const isTweet =
    /(^|\.)(x|twitter)\.com$/.test(host) && preview.image_url?.includes("/profile_images/");
  if (isTweet && image && preview.author) {
    return <TweetCard preview={preview} avatar={image} brand={brand} tags={tags} priority={priority} />;
  }

  const gridImages = (preview.images ?? [])
    .map((i) => i.thumbnail ?? i.image_url)
    .filter((src): src is string => !!src)
    .slice(0, 4);

  const details = (
    <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-1">
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 pt-2.5 after:absolute after:inset-0"
      >
        {headline ? (
          <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground [overflow-wrap:anywhere]">
            {headline}
          </p>
        ) : (
          <span className="sr-only">{site}</span>
        )}
      </a>
      <div className="flex min-w-0 items-end">
        <PreviewSource preview={preview} brand={brand} site={site} className="flex-1 px-3 pb-2.5" />
        <PreviewTags tags={tags} />
      </div>
    </div>
  );

  if (playing && embed) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <EmbedPlayer embed={embed} />
        <div className="flex border-t border-border">{details}</div>
      </div>
    );
  }

  const thumb = (() => {
    if (!image && !embed) return null;

    if (gridImages.length >= 2 && !embed) {
      const n = gridImages.length;
      return (
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          className={cn(THUMB_BOX, "grid grid-cols-2 gap-px bg-border", n > 2 && "grid-rows-2")}
        >
          {gridImages.map((src, idx) => (
            <PreviewThumb
              key={src}
              src={src}
              alt=""
              priority={priority}
              className={cn("h-full w-full bg-muted object-cover", n === 3 && idx === 0 && "row-span-2")}
            />
          ))}
        </a>
      );
    }

    const img = image ? (
      <PreviewThumb
        src={image}
        alt=""
        priority={priority}
        className={cn("absolute inset-0 h-full w-full", thumbFit(preview.image_width, preview.image_height))}
      />
    ) : null;

    if (embed) {
      return (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play — ${preview.title ?? site}`}
          className={cn(THUMB_BOX, "cursor-pointer")}
        >
          {img}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-md transition-colors duration-200 group-hover:bg-black/70">
              <Play className="size-3.5 translate-x-px fill-current" />
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
        tabIndex={-1}
        className={THUMB_BOX}
      >
        {img}
      </a>
    );
  })();

  return (
    <div className="group flex overflow-hidden rounded-xl border border-border bg-card transition-colors hover:bg-accent/40">
      {thumb}
      {details}
    </div>
  );
}
