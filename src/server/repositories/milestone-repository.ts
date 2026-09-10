import "server-only";
import type { Milestone } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `Milestone` (Build 27 — Roadmap Module 21). Deliberately
 * has no stored status/progress column (see the schema's own doc
 * comment) — this repository only persists the facts that genuinely
 * live independently of child `ProjectTask` rows: identity, ordering,
 * target date, customer visibility, and cancellation. Progress/"complete"
 * are always derived server-side (`src/lib/projects/progress.ts`), never
 * read from here.
 */
export const milestoneRepository = {
  async create(
    input: { id: string; organizationId: string; projectId: string; title: string; description: string | null; sortOrder: number; targetDate: Date | null; customerVisible: boolean; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<Milestone> {
    return withDbErrorTranslation(() => tx.milestone.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Milestone | null> {
    return withDbErrorTranslation(() => tx.milestone.findUnique({ where: { id } }));
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<Milestone[]> {
    return withDbErrorTranslation(() => tx.milestone.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }));
  },

  async listForProjects(projectIds: string[], tx: TransactionClient | typeof db = db): Promise<Milestone[]> {
    if (projectIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.milestone.findMany({ where: { projectId: { in: projectIds } }, orderBy: { sortOrder: "asc" } }));
  },

  async update(id: string, data: Partial<{ title: string; description: string | null; targetDate: Date | null; customerVisible: boolean; sortOrder: number }>, tx: TransactionClient | typeof db = db): Promise<Milestone> {
    return withDbErrorTranslation(() => tx.milestone.update({ where: { id }, data }));
  },

  /** CAS-guarded on `cancelledAt IS NULL` — the one independently mutable lifecycle fact this model has. A lost race (already cancelled) returns `null`. */
  async cancel(id: string, data: { cancelledAt: Date; cancelledReason: string; cancelledByUserId: string }, tx: TransactionClient | typeof db = db): Promise<Milestone | null> {
    const result = await withDbErrorTranslation(() => tx.milestone.updateMany({ where: { id, cancelledAt: null }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.milestone.findUnique({ where: { id } }));
  },
};
