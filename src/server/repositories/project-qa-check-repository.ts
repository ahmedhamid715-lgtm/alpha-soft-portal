import "server-only";
import type { ProjectQaCheck, ProjectQaCheckStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `ProjectQaCheck` — scoped to a Project, or optionally
 * further to one Task or Milestone (never both — the DB CHECK constraint
 * enforces the mutual exclusivity). No DELETE grant; `record()` is the
 * only mutation after creation.
 */
export const projectQaCheckRepository = {
  async create(input: { id: string; organizationId: string; projectId: string; taskId: string | null; milestoneId: string | null; title: string; required: boolean }, tx: TransactionClient | typeof db = db): Promise<ProjectQaCheck> {
    return withDbErrorTranslation(() => tx.projectQaCheck.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectQaCheck | null> {
    return withDbErrorTranslation(() => tx.projectQaCheck.findUnique({ where: { id } }));
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<ProjectQaCheck[]> {
    return withDbErrorTranslation(() => tx.projectQaCheck.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  async listForProjects(projectIds: string[], tx: TransactionClient | typeof db = db): Promise<ProjectQaCheck[]> {
    if (projectIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.projectQaCheck.findMany({ where: { projectId: { in: projectIds } } }));
  },

  /** CAS-guarded on `status = PENDING` — recording an outcome is a one-time act, not an editable field; a lost race (already recorded) returns `null`. */
  async record(id: string, data: { status: Exclude<ProjectQaCheckStatus, "PENDING">; checkedByUserId: string; checkedAt: Date; notes: string | null }, tx: TransactionClient | typeof db = db): Promise<ProjectQaCheck | null> {
    const result = await withDbErrorTranslation(() => tx.projectQaCheck.updateMany({ where: { id, status: "PENDING" }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectQaCheck.findUnique({ where: { id } }));
  },
};
