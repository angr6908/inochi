import type { Metadata } from "next";
// Geist (official npm package, via next/font) — UI chrome. Sets --font-geist-sans.
import { GeistSans } from "geist/font/sans";
// Roboto + Noto Sans JP via next/font/google (self-hosted at build, like Geist).
// Roboto: post content + tags (the font YouTube serves). Noto Sans JP: CJK glyphs
// for post content + UI fallback.
import { Roboto, Noto_Sans_JP } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { SeedEmojis } from "@/components/seed-emojis";
import { fetchEmojis } from "@/lib/ssr";
import { SITE_NAME, SITE_DESCRIPTION, resolveOrigin } from "@/lib/site";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});

export function generateMetadata(): Metadata {
  const origin = resolveOrigin({});
  return {
    metadataBase: new URL(origin),
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
    twitter: {
      card: "summary",
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [cookieStore, emojis] = await Promise.all([cookies(), fetchEmojis()]);
  const authed = cookieStore.get("auth")?.value === "1";
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${roboto.variable} ${notoSansJP.variable}`}
    >
      <body className="antialiased">
        <SeedEmojis emojis={emojis} />
        <Providers initialAuthed={authed}>{children}</Providers>
      </body>
    </html>
  );
}
