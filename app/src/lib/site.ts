export const SITE_NAME = "inochi";
export const SITE_DESCRIPTION = "A minimal microblog";

export const BACKEND_ORIGIN = (
  process.env.BACKEND_ORIGIN || "http://127.0.0.1:3001"
).replace(/\/+$/, "");

const ALLOWED_HOSTS = (process.env.SITE_DOMAINS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const DEFAULT_ORIGIN = ALLOWED_HOSTS.length > 0
  ? `https://${ALLOWED_HOSTS[0]}`
  : "http://localhost:3000";

export function resolveOrigin(h: {
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}): string {
  const host = (h.forwardedHost || h.host || "").split(",")[0].trim().toLowerCase();
  if (!host) return DEFAULT_ORIGIN;
  if (ALLOWED_HOSTS.length > 0 && !ALLOWED_HOSTS.includes(host)) return DEFAULT_ORIGIN;
  const proto = (h.forwardedProto || (host.startsWith("localhost") ? "http" : "https"))
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}
