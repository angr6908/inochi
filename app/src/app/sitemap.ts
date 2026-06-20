import type { MetadataRoute } from "next";
import { BACKEND_ORIGIN } from "@/lib/site";
import { currentOrigin } from "@/lib/origin";

const FETCH_TTL = 3600;

interface PostRow {
  id: string;
  root_post_id: string | null;
  updated_at: string;
}

function parseUtc(ts: string): Date {
  return new Date(ts.replace(" ", "T") + "Z");
}

async function rootPosts(): Promise<PostRow[]> {
  const out: PostRow[] = [];
  const limit = 100;
  for (let page = 1; page <= 50; page++) {
    let data: { posts?: PostRow[]; pages?: number };
    try {
      const res = await fetch(
        `${BACKEND_ORIGIN}/api/posts?page=${page}&limit=${limit}`,
        { next: { revalidate: FETCH_TTL } },
      );
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break;
    }
    for (const p of data.posts ?? []) {
      if (!p.root_post_id || p.root_post_id === p.id) out.push(p);
    }
    if (page >= (data.pages ?? 1)) break;
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await currentOrigin();
  const posts = await rootPosts();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${origin}/about`, changeFrequency: "monthly", priority: 0.3 },
  ];

  const postRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${origin}/post/${p.id}`,
    lastModified: parseUtc(p.updated_at),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...postRoutes];
}
