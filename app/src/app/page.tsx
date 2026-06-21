import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { serverGet } from "@/lib/ssr";
import { HomeContent, type InitialPage } from "./home-content";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string | string[] }>;
}) {
  const raw = (await searchParams).tag;
  const tag = (Array.isArray(raw) ? raw[0] : raw) || undefined;
  const params = new URLSearchParams({ page: "1", limit: "20" });
  if (tag) params.set("tag", tag);
  const initial = await serverGet<InitialPage>(`/api/posts?${params}`);

  return (
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      <HomeContent initial={initial} initialTag={tag} />
    </Suspense>
  );
}
