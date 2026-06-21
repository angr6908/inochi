import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { serverGet } from "@/lib/ssr";
import { SearchContent, type InitialSearch } from "./search-content";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw) || "";
  const initial = q
    ? await serverGet<InitialSearch>(`/api/search?q=${encodeURIComponent(q)}&page=1&limit=20`)
    : null;

  return (
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      <SearchContent key={q} initialQ={q} initial={initial} />
    </Suspense>
  );
}
