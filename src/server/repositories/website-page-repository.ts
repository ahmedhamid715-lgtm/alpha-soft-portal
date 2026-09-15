import "server-only";
import type { WebsitePage, WebsitePageType, WebsitePageStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";
import { WEBSITE_PAGE_READY_STATUSES } from "@/lib/website-dev/page-lifecycle";

export interface WebsitePageListFilters {
  status?: WebsitePageStatus;
  search?: string;
}

export interface WebsitePageCounts {
  pageCount: number;
  requiredPageCount: number;
  completedRequiredPageCount: number;
}

function emptyCounts(): WebsitePageCounts {
  return { pageCount: 0, requiredPageCount: 0, completedRequiredPageCount: 0 };
}

/**
 * Data access for `WebsitePage` (Build 32 — Roadmap Module 26). No
 * DELETE grant — retired via `status = ARCHIVED`. `path` is unique per
 * site (real DB constraint). Paginated list is mandatory — a real site
 * may carry hundreds/thousands of pages (master prompt's own explicit
 * scale warning); never load the full inventory for an overview.
 */
export const websitePageRepository = {
  async create(
    input: { id: string; organizationId: string; siteId: string; title: string; path: string; pageType: WebsitePageType; required: boolean; sortOrder: number; projectTaskId: string | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<WebsitePage> {
    return withDbErrorTranslation(() => tx.websitePage.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<WebsitePage | null> {
    return withDbErrorTranslation(() => tx.websitePage.findUnique({ where: { id } }));
  },

  async findByPath(siteId: string, path: string, tx: TransactionClient | typeof db = db): Promise<WebsitePage | null> {
    return withDbErrorTranslation(() => tx.websitePage.findUnique({ where: { siteId_path: { siteId, path } } }));
  },

  async listForSite(siteId: string, params: OffsetPaginationParams, filters: WebsitePageListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<WebsitePage>> {
    const where = { siteId, ...(filters.status ? { status: filters.status } : {}), ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" as const } } : {}) };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([tx.websitePage.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }), tx.websitePage.count({ where })]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /**
   * Exact page/required-page/completed-required-page counts for one
   * site — used by every KPI/readiness/launch-gate path, NEVER by
   * materializing page rows. Codex Performance Engineer finding
   * PERF-01 (Build 32 review) — an earlier version of this method
   * (`listForSiteUnbounded()`) capped page rows at 2000 and treated
   * that truncated result as an exact count, which silently
   * undercounted (and could therefore let `recordWebsiteLaunch()`
   * compute a false `READY`) on any site with more than 2000 pages.
   * `groupBy` returns at most `4 status × 2 required` = 8 rows per site
   * regardless of how many total pages exist, so this is both exact
   * AND bounded — the previous approach was neither.
   */
  async countsForSite(siteId: string, tx: TransactionClient | typeof db = db): Promise<WebsitePageCounts> {
    const map = await this.countsForSites([siteId], tx);
    return map.get(siteId) ?? emptyCounts();
  },

  /** Batched across several sites at once — never one query per site, and never one global row cap shared across all sites (PERF-01's second consequence: `listForSites()`'s old shared 2000-row cap could silently omit an entire site's pages when several sites' totals exceeded it together). */
  async countsForSites(siteIds: string[], tx: TransactionClient | typeof db = db): Promise<Map<string, WebsitePageCounts>> {
    const result = new Map<string, WebsitePageCounts>();
    for (const siteId of siteIds) result.set(siteId, emptyCounts());
    if (siteIds.length === 0) return result;

    const rows = await withDbErrorTranslation(() => tx.websitePage.groupBy({ by: ["siteId", "required", "status"], where: { siteId: { in: siteIds } }, _count: { _all: true } }));
    for (const row of rows) {
      const counts = result.get(row.siteId);
      if (!counts) continue;
      const n = row._count._all;
      counts.pageCount += n;
      if (row.required) {
        counts.requiredPageCount += n;
        if (WEBSITE_PAGE_READY_STATUSES.includes(row.status)) counts.completedRequiredPageCount += n;
      }
    }
    return result;
  },

  async update(id: string, data: Partial<{ title: string; pageType: WebsitePageType; required: boolean; sortOrder: number; projectTaskId: string | null }>, tx: TransactionClient | typeof db = db): Promise<WebsitePage> {
    return withDbErrorTranslation(() => tx.websitePage.update({ where: { id }, data }));
  },

  /** CAS-guarded on the exact `from` status — closes a lost-update race between two concurrent lifecycle transitions on the same page. */
  async transition(id: string, from: WebsitePageStatus, to: WebsitePageStatus, tx: TransactionClient | typeof db = db): Promise<WebsitePage | null> {
    const result = await withDbErrorTranslation(() => tx.websitePage.updateMany({ where: { id, status: from }, data: { status: to } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.websitePage.findUnique({ where: { id } }));
  },
};
