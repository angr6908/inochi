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

export const metadata: Metadata = {
  title: "inochi",
  description: "A minimal microblog",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = (await cookies()).get("auth")?.value === "1";
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${roboto.variable} ${notoSansJP.variable}`}
    >
      <body className="antialiased">
        <Providers initialAuthed={authed}>{children}</Providers>
      </body>
    </html>
  );
}
