import "server-only";
import type { ProjectTaskDependency } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import type { DependencyEdge } from "@/lib/projects/dependency-graph";

/**
 * Data access for `ProjectTaskDependency` — "B depends on A" is stored as
 * `{taskId: B, dependsOnTaskId: A}` (see the schema's own doc comment and
 * `src/lib/projects/dependency-graph.ts`). No DELETE grant on this table
 * (Build 27's own platform-wide no-DELETE discipline) — a dependency
 * created in error is a known, documented limitation of this build (see
 * project-management.md "Known limitations"), not silently worked around.
 */
export const projectTaskDependencyRepository = {
  async create(input: { id: string; organizationId: string; projectId: string; taskId: string; dependsOnTaskId: string; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<ProjectTaskDependency> {
    return withDbErrorTranslation(() => tx.projectTaskDependency.create({ data: input }));
  },

  /** Every edge for the project — the exact shape `wouldCreateCycle()` consumes. Called with the project row already locked (`SELECT ... FOR UPDATE`) by the service layer so this read is consistent with the write that follows in the same transaction. */
  async listEdgesForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<DependencyEdge[]> {
    const rows = await withDbErrorTranslation(() => tx.projectTaskDependency.findMany({ where: { projectId }, select: { taskId: true, dependsOnTaskId: true } }));
    return rows;
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTaskDependency[]> {
    return withDbErrorTranslation(() => tx.projectTaskDependency.findMany({ where: { projectId } }));
  },

  async listForTask(taskId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTaskDependency[]> {
    return withDbErrorTranslation(() => tx.projectTaskDependency.findMany({ where: { taskId } }));
  },
};
