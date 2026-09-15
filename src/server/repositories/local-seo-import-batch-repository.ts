import "server-only";
import type { LocalSeoImportBatch } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `LocalSeoImportBatch` (Build 31 — Roadmap Module 25) — one row per CSV import attempt, for provenance. No DELETE grant. Mirrors `seoImportBatchRepository` exactly. */
export const localSeoImportBatchRepository = {
  async create(
    input: { id: string; organizationId: string; engagementId: string; fileName: string | null; rowCount: number; importedCount: number; skippedCount: number; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<LocalSeoImportBatch> {
    return withDbErrorTranslation(() => tx.localSeoImportBatch.create({ data: input }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoImportBatch[]> {
    return withDbErrorTranslation(() => tx.localSeoImportBatch.findMany({ where: { engagementId }, orderBy: { createdAt: "desc" }, take: 50 }));
  },

  /**
   * Finalizes the real `importedCount`/`skippedCount` once observations
   * have actually been inserted — the batch row must exist BEFORE those
   * inserts (they reference it by FK) yet its real counts are only known
   * AFTER. Applies Build 30's own found FK-ordering lesson
   * (`seoImportBatchRepository.finalizeCounts()`) from the start.
   */
  async finalizeCounts(id: string, importedCount: number, skippedCount: number, tx: TransactionClient | typeof db = db): Promise<LocalSeoImportBatch> {
    return withDbErrorTranslation(() => tx.localSeoImportBatch.update({ where: { id }, data: { importedCount, skippedCount } }));
  },
};
