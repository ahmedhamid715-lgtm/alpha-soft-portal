import { z } from "zod";

/**
 * Pagination conventions every future list endpoint should reuse (spec
 * section 26) — not a data table component, just the backend contract.
 * Two shapes are supported:
 *
 *   - Offset (page/limit): simple, supports "jump to page N", fine for
 *     small-to-medium result sets (most admin list views).
 *   - Cursor: for large or frequently-mutated datasets where offset
 *     pagination would skip/duplicate rows as records are inserted —
 *     e.g. an audit log or an activity feed.
 *
 * Total counts are opt-in (`totalCount?`), per spec: "total counts only
 * when useful" — a `COUNT(*)` over a large table on every page load is a
 * real cost or a real footgun, so callers explicitly ask for it.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type OffsetPaginationParams = z.infer<typeof offsetPaginationSchema>;

export interface OffsetPageInfo {
  page: number;
  limit: number;
  totalCount?: number;
  hasNextPage: boolean;
}

export interface OffsetPaginatedResult<T> {
  items: T[];
  pageInfo: OffsetPageInfo;
}

export function toOffsetPaginatedResult<T>(
  items: T[],
  params: OffsetPaginationParams,
  totalCount?: number,
): OffsetPaginatedResult<T> {
  const hasNextPage =
    totalCount !== undefined ? params.page * params.limit < totalCount : items.length === params.limit;

  return {
    items,
    pageInfo: { page: params.page, limit: params.limit, totalCount, hasNextPage },
  };
}

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type CursorPaginationParams = z.infer<typeof cursorPaginationSchema>;

export interface CursorPageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface CursorPaginatedResult<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

/**
 * Feed this `rows` fetched with `limit + 1` (the standard "fetch one extra
 * to know if there's a next page" trick) — never a full unbounded query.
 */
export function toCursorPaginatedResult<T>(
  rows: T[],
  limit: number,
  getCursor: (item: T) => string,
): CursorPaginatedResult<T> {
  const hasNextPage = rows.length > limit;
  const items = hasNextPage ? rows.slice(0, limit) : rows;
  const nextCursor = hasNextPage && items.length > 0 ? getCursor(items[items.length - 1]) : null;

  return { items, pageInfo: { nextCursor, hasNextPage } };
}

export interface SortParam {
  field: string;
  direction: "asc" | "desc";
}
