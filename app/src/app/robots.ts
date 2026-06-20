import type { MetadataRoute } from "next";
import { currentOrigin } from "@/lib/origin";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await currentOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/settings", "/search"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
