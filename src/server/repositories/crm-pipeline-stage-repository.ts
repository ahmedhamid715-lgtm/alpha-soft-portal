import "server-only";
import type { CrmPipelineStage } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `CrmPipelineStage` — RLS-protected. Ordering is a
 * gap-based `sortOrder` (seeded in increments of 1000 — see
 * `crm-pipeline-stage-service.ts`'s own `moveStage()` for the
 * midpoint-renumber strategy this enables without a full-table
 * renumber on every ordinary reorder).
 */
export const crmPipelineStageRepository = {
  async create(
    input: { id: string; organizationId: string; pipelineId: string; name: string; sortOrder: number; isWon?: boolean; isLost?: boolean; defaultProbability?: number | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmPipelineStage> {
    return withDbErrorTranslation(() =>
      tx.crmPipelineStage.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          pipelineId: input.pipelineId,
          name: input.name,
          sortOrder: input.sortOrder,
          isWon: input.isWon ?? false,
          isLost: input.isLost ?? false,
          defaultProbability: input.defaultProbability ?? null,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmPipelineStage | null> {
    return withDbErrorTranslation(() => tx.crmPipelineStage.findUnique({ where: { id } }));
  },

  async listForPipeline(pipelineId: string, filters: { status?: "ACTIVE" | "ARCHIVED" } = {}, tx: TransactionClient | typeof db = db): Promise<CrmPipelineStage[]> {
    return withDbErrorTranslation(() =>
      tx.crmPipelineStage.findMany({ where: { pipelineId, ...(filters.status ? { status: filters.status } : {}) }, orderBy: { sortOrder: "asc" }, take: 200 }),
    );
  },

  /** Batched form of `listForPipeline()` for pages that render every pipeline's own stages at once (the settings page) — one query instead of one per pipeline. Caller groups the flat result by `pipelineId`; ordering is stable per pipeline (`pipelineId`, then `sortOrder`). `pipelineIds` is expected to already be organization-owned (RLS still scopes it either way), so this performs no separate ownership check. */
  async listForPipelines(pipelineIds: string[], filters: { status?: "ACTIVE" | "ARCHIVED" } = {}, tx: TransactionClient | typeof db = db): Promise<CrmPipelineStage[]> {
    if (pipelineIds.length === 0) return [];
    return withDbErrorTranslation(() =>
      tx.crmPipelineStage.findMany({
        where: { pipelineId: { in: pipelineIds }, ...(filters.status ? { status: filters.status } : {}) },
        orderBy: [{ pipelineId: "asc" }, { sortOrder: "asc" }],
        take: 2000,
      }),
    );
  },

  /** The two real neighbors (by sortOrder) around a target position within one pipeline — used to compute a midpoint sortOrder for an ordinary single-position reorder. */
  async findNeighbors(pipelineId: string, sortOrder: number, tx: TransactionClient | typeof db = db): Promise<{ before: CrmPipelineStage | null; after: CrmPipelineStage | null }> {
    const [before, after] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmPipelineStage.findFirst({ where: { pipelineId, sortOrder: { lt: sortOrder } }, orderBy: { sortOrder: "desc" } }),
        tx.crmPipelineStage.findFirst({ where: { pipelineId, sortOrder: { gt: sortOrder } }, orderBy: { sortOrder: "asc" } }),
      ]),
    );
    return { before, after };
  },

  async update(
    id: string,
    data: Partial<{ name: string; sortOrder: number; isWon: boolean; isLost: boolean; defaultProbability: number | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmPipelineStage> {
    return withDbErrorTranslation(() => tx.crmPipelineStage.update({ where: { id }, data }));
  },

  /** Full renumber (increments of 1000) — the rare fallback when gap-based reordering has run out of room between two neighbors. Runs over every stage in one pipeline, which is always small (a handful of stages), never a mass-table operation. */
  async renumber(pipelineId: string, orderedStageIds: string[], tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => Promise.all(orderedStageIds.map((id, index) => tx.crmPipelineStage.update({ where: { id, pipelineId }, data: { sortOrder: (index + 1) * 1000 } }))));
  },

  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<CrmPipelineStage> {
    return withDbErrorTranslation(() => tx.crmPipelineStage.update({ where: { id }, data: { status: "ARCHIVED" } }));
  },

  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<CrmPipelineStage> {
    return withDbErrorTranslation(() => tx.crmPipelineStage.update({ where: { id }, data: { status: "ACTIVE" } }));
  },
};
