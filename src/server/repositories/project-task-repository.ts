import "server-only";
import type { ProjectTask, ProjectTaskStatus, ProjectPriority } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface ProjectTaskCreateInput {
  id: string;
  organizationId: string;
  projectId: string;
  milestoneId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  priority: ProjectPriority;
  assignedToUserId: string | null;
  dueDate: Date | null;
  sortOrder: number;
  customerVisible: boolean;
  createdByUserId: string;
}

/**
 * Data access for `ProjectTask` (Build 27 — Roadmap Module 21) — covers
 * BOTH root project-scoped tasks and their one-level-deep subtasks (the
 * self-referencing `parentTaskId`; the DB trigger rejects a subtask of a
 * subtask). Never the Roadmap 22 global task engine — every row here is
 * `projectId`-scoped by construction. No DELETE grant; cancellation is
 * the terminal write, matching every other domain in this build.
 */
export const projectTaskRepository = {
  async create(input: ProjectTaskCreateInput, tx: TransactionClient | typeof db = db): Promise<ProjectTask> {
    return withDbErrorTranslation(() => tx.projectTask.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectTask | null> {
    return withDbErrorTranslation(() => tx.projectTask.findUnique({ where: { id } }));
  },

  /** Row-locked read — used by `completeTask()` (dependency-gate check must see a consistent snapshot) and by subtask-parent validation under concurrent modification. */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<ProjectTask | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM project_tasks WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.projectTask.findUnique({ where: { id: locked[0]!.id } }));
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTask[]> {
    return withDbErrorTranslation(() => tx.projectTask.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }));
  },

  async listForProjects(projectIds: string[], tx: TransactionClient | typeof db = db): Promise<ProjectTask[]> {
    if (projectIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.projectTask.findMany({ where: { projectId: { in: projectIds } }, orderBy: { sortOrder: "asc" } }));
  },

  async listSubtasks(parentTaskId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTask[]> {
    return withDbErrorTranslation(() => tx.projectTask.findMany({ where: { parentTaskId }, orderBy: { sortOrder: "asc" } }));
  },

  async listAssignedToUser(assignedToUserId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTask[]> {
    return withDbErrorTranslation(() => tx.projectTask.findMany({ where: { assignedToUserId, status: { notIn: ["DONE", "CANCELLED"] } }, orderBy: { dueDate: "asc" }, take: 200 }));
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; priority: ProjectPriority; assignedToUserId: string | null; dueDate: Date | null; customerVisible: boolean; milestoneId: string | null; sortOrder: number }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<ProjectTask> {
    return withDbErrorTranslation(() => tx.projectTask.update({ where: { id }, data }));
  },

  /** CAS-guarded ordinary (non-terminal) status transition — `expectedStatuses` is the caller's own `canTransitionTask()`-derived allowed-from set. */
  async transitionStatus(id: string, expectedStatuses: ProjectTaskStatus[], status: ProjectTaskStatus, tx: TransactionClient | typeof db = db): Promise<ProjectTask | null> {
    const result = await withDbErrorTranslation(() => tx.projectTask.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectTask.findUnique({ where: { id } }));
  },

  async complete(id: string, expectedStatuses: ProjectTaskStatus[], completedByUserId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTask | null> {
    const result = await withDbErrorTranslation(() => tx.projectTask.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status: "DONE", completedAt: new Date(), completedByUserId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectTask.findUnique({ where: { id } }));
  },

  /** Reopen DONE -> TODO/IN_PROGRESS — clears the completion fields (same "never carry stale completion facts forward" discipline as `projectRepository.reopen()`). */
  async reopen(id: string, to: "TODO" | "IN_PROGRESS", tx: TransactionClient | typeof db = db): Promise<ProjectTask | null> {
    const result = await withDbErrorTranslation(() => tx.projectTask.updateMany({ where: { id, status: "DONE" }, data: { status: to, completedAt: null, completedByUserId: null } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectTask.findUnique({ where: { id } }));
  },

  async cancel(id: string, expectedStatuses: ProjectTaskStatus[], data: { cancelledAt: Date; cancelledReason: string; cancelledByUserId: string }, tx: TransactionClient | typeof db = db): Promise<ProjectTask | null> {
    const result = await withDbErrorTranslation(() => tx.projectTask.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status: "CANCELLED", ...data } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectTask.findUnique({ where: { id } }));
  },
};
