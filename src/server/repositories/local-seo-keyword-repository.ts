import "server-only";
import type { LocalSeoKeyword, LocalSeoSearchSurface, LocalSeoDevice, LocalSeoKeywordStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";

export interface LocalSeoKeywordDedupKey {
  locationId: string;
  normalizedPhrase: string;
  searchSurface: LocalSeoSearchSurface;
  device: LocalSeoDevice;
  country: string | null;
  locale: string | null;
  searchLabel: string | null;
}

export interface LocalSeoKeywordListFilters {
  status?: LocalSeoKeywordStatus;
  search?: string;
}

/**
 * Data access for `LocalSeoKeyword` (Build 31 — Roadmap Module 25). No
 * DELETE grant — retired via `archive()`. The real dedup guarantee is the
 * DB's own functional unique index (`local_seo_keywords_dedup_key`,
 * COALESCE-normalized nullable dimensions) — `findByDedupKey()` below is
 * only the friendly read-side check, mirroring `seoKeywordRepository`'s
 * own exact reasoning.
 */
export const localSeoKeywordRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      locationId: string;
      phrase: string;
      normalizedPhrase: string;
      searchSurface: LocalSeoSearchSurface;
      device: LocalSeoDevice;
      country: string | null;
      locale: string | null;
      searchLat: number | null;
      searchLng: number | null;
      searchLabel: string | null;
      tags: string[];
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<LocalSeoKeyword> {
    return withDbErrorTranslation(() => tx.localSeoKeyword.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoKeyword | null> {
    return withDbErrorTranslation(() => tx.localSeoKeyword.findUnique({ where: { id } }));
  },

  async findByDedupKey(key: LocalSeoKeywordDedupKey, tx: TransactionClient | typeof db = db): Promise<LocalSeoKeyword | null> {
    return withDbErrorTranslation(() =>
      tx.localSeoKeyword.findFirst({
        where: { locationId: key.locationId, normalizedPhrase: key.normalizedPhrase, searchSurface: key.searchSurface, device: key.device, country: key.country, locale: key.locale, searchLabel: key.searchLabel },
      }),
    );
  },

  async listForLocation(locationId: string, params: OffsetPaginationParams, filters: LocalSeoKeywordListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<LocalSeoKeyword>> {
    const where = {
      locationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { phrase: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.localSeoKeyword.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.localSeoKeyword.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Every ACTIVE keyword for a location, unpaginated — for KPI aggregation and rank-table rendering. Bounded to 500 (a realistic ceiling for one location's own tracked keyword set). */
  async listActiveForLocation(locationId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoKeyword[]> {
    return withDbErrorTranslation(() => tx.localSeoKeyword.findMany({ where: { locationId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  /** Batched across every location in an engagement — never one query per location. */
  async listActiveForLocations(locationIds: string[], tx: TransactionClient | typeof db = db): Promise<LocalSeoKeyword[]> {
    if (locationIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.localSeoKeyword.findMany({ where: { locationId: { in: locationIds }, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }));
  },

  /** CAS-guarded on `status = ACTIVE` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoKeyword | null> {
    const result = await withDbErrorTranslation(() => tx.localSeoKeyword.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoKeyword.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — a lost race (already active) returns `null`. */
  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoKeyword | null> {
    const result = await withDbErrorTranslation(() => tx.localSeoKeyword.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoKeyword.findUnique({ where: { id } }));
  },
};
