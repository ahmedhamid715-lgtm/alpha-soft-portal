import "server-only";
import type { GhlImportBatch } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `GhlImportBatch` (Build 34 — Roadmap Module 28) — pure append-only evidence of an asset CSV import. No UPDATE, no DELETE grant; `create()` is the only mutation. */
export const ghlImportBatchRepository = {
  async create(
    input: { id: string; organizationId: string; workspaceId: string; importedByUserId: string; totalRowCount: number; importedRowCount: number; skippedRowCount: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<GhlImportBatch> {
    return withDbErrorTranslation(() => tx.ghlImportBatch.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<GhlImportBatch | null> {
    return withDbErrorTranslation(() => tx.ghlImportBatch.findUnique({ where: { id } }));
  },

  async listForWorkspace(workspaceId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<GhlImportBatch[]> {
    return withDbErrorTranslation(() => tx.ghlImportBatch.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: limit }));
  },
};
