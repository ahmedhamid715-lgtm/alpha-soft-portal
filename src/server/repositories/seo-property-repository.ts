import "server-only";
import type { SeoProperty } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `SeoProperty` (Build 30 — Roadmap Module 24). No
 * DELETE grant — retired via `archive()`. Bounded to 100 per engagement
 * (the realistic-total assumption — a real SEO engagement tracks a
 * handful of properties, not hundreds).
 */
export const seoPropertyRepository = {
  async create(
    input: { id: string; organizationId: string; engagementId: string; normalizedOrigin: string; displayUrl: string; targetCountry: string | null; targetLocale: string | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<SeoProperty> {
    return withDbErrorTranslation(() => tx.seoProperty.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<SeoProperty | null> {
    return withDbErrorTranslation(() => tx.seoProperty.findUnique({ where: { id } }));
  },

  async findByNormalizedOrigin(engagementId: string, normalizedOrigin: string, tx: TransactionClient | typeof db = db): Promise<SeoProperty | null> {
    return withDbErrorTranslation(() => tx.seoProperty.findUnique({ where: { engagementId_normalizedOrigin: { engagementId, normalizedOrigin } } }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<SeoProperty[]> {
    return withDbErrorTranslation(() => tx.seoProperty.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" }, take: 100 }));
  },

  /** Batched — never one query per engagement. Used by list/KPI views composing several engagements at once. */
  async listForEngagements(engagementIds: string[], tx: TransactionClient | typeof db = db): Promise<SeoProperty[]> {
    if (engagementIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.seoProperty.findMany({ where: { engagementId: { in: engagementIds } }, orderBy: { createdAt: "asc" } }));
  },

  async update(id: string, data: Partial<{ targetCountry: string | null; targetLocale: string | null }>, tx: TransactionClient | typeof db = db): Promise<SeoProperty> {
    return withDbErrorTranslation(() => tx.seoProperty.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status = ACTIVE` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<SeoProperty | null> {
    const result = await withDbErrorTranslation(() => tx.seoProperty.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoProperty.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — a lost race (already active) returns `null`. */
  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<SeoProperty | null> {
    const result = await withDbErrorTranslation(() => tx.seoProperty.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoProperty.findUnique({ where: { id } }));
  },
};
