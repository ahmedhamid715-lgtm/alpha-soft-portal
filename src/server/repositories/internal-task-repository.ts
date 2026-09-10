import "server-only";
import type { InternalTask, InternalTaskStatus, ProjectPriority } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginationParams, OffsetPaginatedResult } from "@/lib/platform/pagination";
import { toOffsetPaginatedResult } from "@/lib/platform/pagination";

export interface InternalTaskListFilters {
  status?: InternalTaskStatus;
  assignedToUserId?: string;
}

/**
 * Data access for `InternalTask` (Build 28 — Roadmap Module 22) — the
 * one genuinely standalone task entity this module owns, for work that
 * belongs to no existing domain (never CRM/Project/Onboarding work —
 * see docs/architecture/task-management.md "Standalone task decision").
 * Mirrors `crmTaskRepository`'s own shape closely. No DELETE grant —
 * same platform-wide discipline every other build's own tables follow.
 */
export const internalTaskRepository = {
  async create(
    input: { id: string; organizationId: string; title: string; description: string | null; priority: ProjectPriority; assignedToUserId: string | null; dueAt: Date | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<InternalTask> {
    return withDbErrorTranslation(() => tx.internalTask.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<InternalTask | null> {
    return withDbErrorTranslation(() => tx.internalTask.findUnique({ where: { id } }));
  },

  /**
   * Ordering matches the global task query's own frozen tie-break
   * exactly (`dueAt` nulls-last, then `createdAt`, then `id`) — a
   * `dueAt`-only order (the original version) was not deterministic for
   * two rows with equal or null due dates, so an offset page could
   * shuffle rows between requests. Fixed per Codex Performance Engineer
   * review; see the matching composite index on `InternalTask` in
   * `prisma/schema.prisma` and docs/architecture/task-management.md
   * "Performance".
   */
  async listForOrganization(organizationId: string, params: OffsetPaginationParams, filters: InternalTaskListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<InternalTask>> {
    const where = { organizationId, ...(filters.status ? { status: filters.status } : {}), ...(filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {}) };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.internalTask.findMany({ where, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.internalTask.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; priority: ProjectPriority; assignedToUserId: string | null; dueAt: Date | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<InternalTask> {
    return withDbErrorTranslation(() => tx.internalTask.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status NOT IN (COMPLETED, CANCELLED)` — a lost race (already terminal) returns `null`. */
  async complete(id: string, completedByUserId: string, tx: TransactionClient | typeof db = db): Promise<InternalTask | null> {
    const result = await withDbErrorTranslation(() => tx.internalTask.updateMany({ where: { id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "COMPLETED", completedAt: new Date(), completedByUserId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.internalTask.findUnique({ where: { id } }));
  },

  /** Reopen a COMPLETED task back to OPEN — clears the completion fields, same "never carry a stale completion fact forward" discipline every other build in this codebase follows. */
  async reopen(id: string, tx: TransactionClient | typeof db = db): Promise<InternalTask | null> {
    const result = await withDbErrorTranslation(() => tx.internalTask.updateMany({ where: { id, status: "COMPLETED" }, data: { status: "OPEN", completedAt: null, completedByUserId: null } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.internalTask.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status NOT IN (COMPLETED, CANCELLED)` — a lost race (already terminal) returns `null`. */
  async cancel(id: string, data: { cancelledReason: string; cancelledByUserId: string }, tx: TransactionClient | typeof db = db): Promise<InternalTask | null> {
    const result = await withDbErrorTranslation(() => tx.internalTask.updateMany({ where: { id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), ...data } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.internalTask.findUnique({ where: { id } }));
  },
};
