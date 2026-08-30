import "server-only";
import type { CrmTask, CrmTaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export interface CrmTaskListFilters {
  status?: CrmTaskStatus;
  assignedToUserId?: string;
  leadId?: string;
  companyId?: string;
  contactId?: string;
}

/** Data access for `CrmTask` — RLS-protected. This is the CRM-scoped follow-up/task list (Roadmap 13's own scope), never the global cross-module Task Management engine (Roadmap 22) — see crm-architecture.md "CRM task boundary." Exactly one of `leadId`/`companyId`/`contactId` is set, enforced by a DB CHECK constraint. */
export const crmTaskRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      leadId: string | null;
      companyId: string | null;
      contactId: string | null;
      title: string;
      description: string | null;
      dueAt: Date | null;
      assignedToUserId: string | null;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmTask> {
    return withDbErrorTranslation(() =>
      tx.crmTask.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          leadId: input.leadId,
          companyId: input.companyId,
          contactId: input.contactId,
          title: input.title,
          description: input.description,
          dueAt: input.dueAt,
          assignedToUserId: input.assignedToUserId,
          createdByUserId: input.createdByUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmTask | null> {
    return withDbErrorTranslation(() => tx.crmTask.findUnique({ where: { id } }));
  },

  async listForOrganization(
    organizationId: string,
    params: OffsetPaginationParams,
    filters: CrmTaskListFilters = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<OffsetPaginatedResult<CrmTask>> {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {}),
      ...(filters.leadId ? { leadId: filters.leadId } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.contactId ? { contactId: filters.contactId } : {}),
    };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmTask.findMany({ where, orderBy: [{ status: "asc" }, { dueAt: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.crmTask.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; dueAt: Date | null; assignedToUserId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmTask> {
    return withDbErrorTranslation(() => tx.crmTask.update({ where: { id }, data }));
  },

  async complete(id: string, tx: TransactionClient | typeof db = db): Promise<CrmTask | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmTask.updateMany({ where: { id, status: "OPEN" }, data: { status: "COMPLETED", completedAt: new Date() } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmTask.findUnique({ where: { id } }));
  },

  async cancel(id: string, tx: TransactionClient | typeof db = db): Promise<CrmTask | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmTask.updateMany({ where: { id, status: "OPEN" }, data: { status: "CANCELLED", completedAt: null } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmTask.findUnique({ where: { id } }));
  },
};
