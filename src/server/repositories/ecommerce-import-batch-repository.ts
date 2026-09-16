import "server-only";
import type { EcommerceImportBatch } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `EcommerceImportBatch` (Build 33 — Roadmap Module 27) — pure append-only evidence of a catalog CSV import. No UPDATE, no DELETE grant; `create()` is the only mutation. */
export const ecommerceImportBatchRepository = {
  async create(
    input: { id: string; organizationId: string; storeId: string; importedByUserId: string; totalRowCount: number; importedRowCount: number; skippedRowCount: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<EcommerceImportBatch> {
    return withDbErrorTranslation(() => tx.ecommerceImportBatch.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceImportBatch | null> {
    return withDbErrorTranslation(() => tx.ecommerceImportBatch.findUnique({ where: { id } }));
  },

  async listForStore(storeId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<EcommerceImportBatch[]> {
    return withDbErrorTranslation(() => tx.ecommerceImportBatch.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: limit }));
  },
};
