import type { Metadata } from "next";
import { cache } from "react";
import { serverGet } from "@/lib/ssr";
import { currentOrigin } from "@/lib/origin";
import { SITE_NAME } from "@/lib/site";
import { PostThread, type InitialThread } from "./post-thread";

// generateMetadata and the page body both need the thread. cache() collapses
// them into a single backend call per request.
const getThread = cache((id: string) => serverGet<InitialThread>(`/api/posts/${id}`));

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}

// Backend timestamps are "YYYY-MM-DD HH:MM:SS" in UTC, as sitemap.ts reads them.
function isoTime(ts: string): string | undefined {
  const d = new Date(`${ts.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getThread(id);
  if (!data) return {};

  const { post } = data;
  // An echo redirects to its root, so the root URL is the one to consolidate on.
  const rootId =
    post.root_post_id && post.root_post_id !== post.id ? post.root_post_id : post.id;
  const url = `${await currentOrigin()}/post/${rootId}`;
  const text = post.content.trim();
  // A post with no text gets no authored stand-in: it falls through to the
  // site title and description from the layout.
  const title = text ? `${excerpt(text, 70)} · ${SITE_NAME}` : undefined;
  const description = text ? excerpt(text, 180) : undefined;
  const images = post.images.slice(0, 1).map((img) => ({
    url: img.url,
    width: img.width ?? undefined,
    height: img.height ?? undefined,
  }));

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      url,
      title,
      description,
      publishedTime: isoTime(post.created_at),
      modifiedTime: isoTime(post.updated_at),
      authors: [post.username],
      images,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getThread(id);
  // Seed only a root thread; an echo id redirects to its root client-side.
  const initial =
    data && (!data.post.root_post_id || data.post.root_post_id === data.post.id) ? data : null;

  return <PostThread key={id} id={id} initial={initial} />;
}
