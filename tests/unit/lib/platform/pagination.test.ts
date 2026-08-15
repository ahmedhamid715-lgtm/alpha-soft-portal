import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_SIZE,
  cursorPaginationSchema,
  offsetPaginationSchema,
  toCursorPaginatedResult,
  toOffsetPaginatedResult,
} from "@/lib/platform/pagination";

describe("offset pagination", () => {
  it("defaults page and limit when omitted", () => {
    const result = offsetPaginationSchema.parse({});
    expect(result).toEqual({ page: 1, limit: 25 });
  });

  it("coerces string query params to numbers", () => {
    const result = offsetPaginationSchema.parse({ page: "2", limit: "10" });
    expect(result).toEqual({ page: 2, limit: 10 });
  });

  it("clamps limit at the maximum page size", () => {
    expect(() => offsetPaginationSchema.parse({ limit: MAX_PAGE_SIZE + 1 })).toThrow();
  });

  it("rejects page below 1", () => {
    expect(() => offsetPaginationSchema.parse({ page: 0 })).toThrow();
  });

  it("computes hasNextPage from totalCount when provided", () => {
    const result = toOffsetPaginatedResult([1, 2, 3], { page: 1, limit: 3 }, 10);
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it("computes hasNextPage as false on the last page", () => {
    const result = toOffsetPaginatedResult([1, 2], { page: 4, limit: 3 }, 11);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it("falls back to a full-page heuristic when totalCount is omitted", () => {
    const fullPage = toOffsetPaginatedResult([1, 2, 3], { page: 1, limit: 3 });
    expect(fullPage.pageInfo.hasNextPage).toBe(true);

    const partialPage = toOffsetPaginatedResult([1, 2], { page: 1, limit: 3 });
    expect(partialPage.pageInfo.hasNextPage).toBe(false);
  });
});

describe("cursor pagination", () => {
  it("defaults limit when omitted", () => {
    expect(cursorPaginationSchema.parse({})).toEqual({ limit: 25 });
  });

  it("detects a next page from the extra fetched row", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = toCursorPaginatedResult(rows, 2, (item) => item.id);
    expect(result.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(result.pageInfo).toEqual({ nextCursor: "b", hasNextPage: true });
  });

  it("reports no next page when fewer rows than limit + 1 are returned", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const result = toCursorPaginatedResult(rows, 5, (item) => item.id);
    expect(result.items).toEqual(rows);
    expect(result.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });
  });
});
