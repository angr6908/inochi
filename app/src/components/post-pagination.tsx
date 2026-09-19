"use client";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// The two gaps are distinct positions, not interchangeable "ellipsis" entries,
// so each gets its own name and can key on it.
type PageItem = number | "gap-before" | "gap-after";

function pageItems(current: number, total: number): PageItem[] {
  const range: number[] = [];
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    range.push(i);
  }
  const items: PageItem[] = [1];
  if (range.length && range[0] > 2) items.push("gap-before");
  items.push(...range);
  if (range.length && range[range.length - 1] < total - 1) items.push("gap-after");
  if (total > 1) items.push(total);
  return items;
}

export function PostPagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) return null;

  const go = (p: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (p >= 1 && p <= pages && p !== page) onChange(p);
  };

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={go(page - 1)}
            aria-disabled={page <= 1}
          />
        </PaginationItem>
        {pageItems(page, pages).map((it) =>
          typeof it === "string" ? (
            <PaginationItem key={it}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={it}>
              <PaginationLink href="#" isActive={it === page} onClick={go(it)}>
                {it}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={go(page + 1)}
            aria-disabled={page >= pages}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
