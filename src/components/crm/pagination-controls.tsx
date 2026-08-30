import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OffsetPageInfo } from "@/lib/platform/pagination";

/**
 * Page-number pagination (not cursor) for CRM list pages — every CRM
 * list is bounded to one organization's own data (the platform's own
 * sales pipeline, never an ever-growing platform-wide dataset the way
 * `/admin/users`'s own cursor pagination guards against), so "jump to
 * page N" is a reasonable, simple pattern here. `basePath` + the
 * already-applied filter params are threaded through so Prev/Next never
 * drop an active filter.
 */
export function CrmPaginationControls({ basePath, filterParams, pageInfo }: { basePath: string; filterParams: URLSearchParams; pageInfo: OffsetPageInfo }) {
  if (pageInfo.page === 1 && !pageInfo.hasNextPage) return null;

  function hrefForPage(page: number): string {
    const params = new URLSearchParams(filterParams);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground tabular-nums">
        Page {pageInfo.page}
        {pageInfo.totalCount !== undefined ? ` of ${Math.max(1, Math.ceil(pageInfo.totalCount / pageInfo.limit))}` : null}
      </p>
      <div className="flex gap-2">
        {pageInfo.page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefForPage(pageInfo.page - 1)}>Previous</Link>
          </Button>
        ) : null}
        {pageInfo.hasNextPage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefForPage(pageInfo.page + 1)}>Next</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
