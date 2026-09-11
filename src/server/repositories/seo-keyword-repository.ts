import "server-only";
import type { SeoKeyword, SeoSearchEngine, SeoDevice, SeoKeywordStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";

export interface SeoKeywordDedupKey {
  propertyId: string;
  normalizedPhrase: string;
  searchEngine: SeoSearchEngine;
  device: SeoDevice;
  country: string | null;
  locale: string | null;
}

export interface SeoKeywordListFilters {
  status?: SeoKeywordStatus;
  search?: string;
}

/**
 * Data access for `SeoKeyword` (Build 30 — Roadmap Module 24). No
 * DELETE grant — retired via `archive()`. The real dedup guarantee is
 * the DB's own functional unique index (`seo_keywords_dedup_key`,
 * COALESCE-normalized nullable dimensions) — `findByDedupKey()` below
 * is only the friendly read-side check (an exact-match `findFirst`
 * correctly treats `null` as "IS NULL", so it agrees with the index's
 * own semantics without needing to replicate COALESCE in application
 * code).
 */
export const seoKeywordRepository = {
  async create(
    input: { id: string; organizationId: string; propertyId: string; phrase: string; normalizedPhrase: string; targetUrl: string | null; searchEngine: SeoSearchEngine; device: SeoDevice; country: string | null; locale: string | null; tags: string[]; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<SeoKeyword> {
    return withDbErrorTranslation(() => tx.seoKeyword.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<SeoKeyword | null> {
    return withDbErrorTranslation(() => tx.seoKeyword.findUnique({ where: { id } }));
  },

  async findByDedupKey(key: SeoKeywordDedupKey, tx: TransactionClient | typeof db = db): Promise<SeoKeyword | null> {
    return withDbErrorTranslation(() =>
      tx.seoKeyword.findFirst({ where: { propertyId: key.propertyId, normalizedPhrase: key.normalizedPhrase, searchEngine: key.searchEngine, device: key.device, country: key.country, locale: key.locale } }),
    );
  },

  async listForProperty(propertyId: string, params: OffsetPaginationParams, filters: SeoKeywordListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<SeoKeyword>> {
    const where = {
      propertyId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { phrase: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.seoKeyword.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.seoKeyword.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Every ACTIVE keyword for a property, unpaginated — for KPI aggregation and rank-table rendering. Bounded to 500 (a realistic ceiling for one property's own tracked keyword set). */
  async listActiveForProperty(propertyId: string, tx: TransactionClient | typeof db = db): Promise<SeoKeyword[]> {
    return withDbErrorTranslation(() => tx.seoKeyword.findMany({ where: { propertyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  /** Batched across every property in an engagement — never one query per property. */
  async listActiveForProperties(propertyIds: string[], tx: TransactionClient | typeof db = db): Promise<SeoKeyword[]> {
    if (propertyIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.seoKeyword.findMany({ where: { propertyId: { in: propertyIds }, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }));
  },

  /** CAS-guarded on `status = ACTIVE` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<SeoKeyword | null> {
    const result = await withDbErrorTranslation(() => tx.seoKeyword.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoKeyword.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — a lost race (already active) returns `null`. */
  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<SeoKeyword | null> {
    const result = await withDbErrorTranslation(() => tx.seoKeyword.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoKeyword.findUnique({ where: { id } }));
  },
};
