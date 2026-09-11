import "server-only";
import type { SeoImportBatch } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `SeoImportBatch` (Build 30 — Roadmap Module 24) — one row per CSV import attempt, for provenance. No DELETE grant. */
export const seoImportBatchRepository = {
  async create(
    input: { id: string; organizationId: string; engagementId: string; fileName: string | null; rowCount: number; importedCount: number; skippedCount: number; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<SeoImportBatch> {
    return withDbErrorTranslation(() => tx.seoImportBatch.create({ data: input }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<SeoImportBatch[]> {
    return withDbErrorTranslation(() => tx.seoImportBatch.findMany({ where: { engagementId }, orderBy: { createdAt: "desc" }, take: 50 }));
  },

  /** Finalizes the real `importedCount`/`skippedCount` once observations have actually been inserted — see `importRankObservations()`'s own comment for why the batch row must exist BEFORE those inserts (they reference it by FK) yet its real counts are only known AFTER. */
  async finalizeCounts(id: string, importedCount: number, skippedCount: number, tx: TransactionClient | typeof db = db): Promise<SeoImportBatch> {
    return withDbErrorTranslation(() => tx.seoImportBatch.update({ where: { id }, data: { importedCount, skippedCount } }));
  },
};
