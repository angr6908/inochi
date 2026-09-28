import type { LinkPreview } from "@/lib/api";
import { previewHasText } from "@/lib/preview-text";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type EmbedProvider = "youtube" | "twitch";
export type Embed = { src: string; title: string; provider: EmbedProvider };

/** Build an inline player URL for embeddable providers, else null. */
export function getEmbed(url: string): Embed | null {
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

export function isTweetPreview(preview: LinkPreview): boolean {
  return (
    /(^|\.)(x|twitter)\.com$/.test(hostOf(preview.url)) &&
    !!preview.image_url?.includes("/profile_images/") &&
    !!preview.author
  );
}

export function previewThumbs(preview: LinkPreview, embed: Embed | null): string[] {
  const image = preview.thumbnail ?? preview.image_url;
  if (!image) return [];
  if (!embed) {
    const grid = (preview.images ?? [])
      .map((i) => i.thumbnail ?? i.image_url)
      .filter((src): src is string => !!src)
      .slice(0, 4);
    if (grid.length >= 2) return grid;
  }
  return [image];
}

export function previewImageUrls(preview: LinkPreview): string[] {
  if (!previewHasText(preview)) return [];
  const image = preview.thumbnail ?? preview.image_url;
  if (image && isTweetPreview(preview)) return [image];
  return previewThumbs(preview, getEmbed(preview.url));
}
