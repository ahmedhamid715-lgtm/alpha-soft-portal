import "server-only";
import type { CrmLead, CrmLeadStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export interface CrmLeadListFilters {
  status?: CrmLeadStatus;
  companyId?: string;
  primaryContactId?: string;
  assignedToUserId?: string;
  search?: string;
}

/** Data access for `CrmLead` — RLS-protected. `companyId` is always a required FK (see schema.prisma); `primaryContactId`/`sourceId`/`assignedToUserId` are all optional. */
export const crmLeadRepository = {
  async create(
    input: { id: string; organizationId: string; companyId: string; primaryContactId: string | null; sourceId: string | null; title: string; description: string | null; assignedToUserId: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmLead> {
    return withDbErrorTranslation(() =>
      tx.crmLead.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          companyId: input.companyId,
          primaryContactId: input.primaryContactId,
          sourceId: input.sourceId,
          title: input.title,
          description: input.description,
          assignedToUserId: input.assignedToUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmLead | null> {
    return withDbErrorTranslation(() => tx.crmLead.findUnique({ where: { id } }));
  },

  async listForOrganization(
    organizationId: string,
    params: OffsetPaginationParams,
    filters: CrmLeadListFilters = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<OffsetPaginatedResult<CrmLead>> {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.primaryContactId ? { primaryContactId: filters.primaryContactId } : {}),
      ...(filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmLead.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.crmLead.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; primaryContactId: string | null; sourceId: string | null; assignedToUserId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmLead> {
    return withDbErrorTranslation(() => tx.crmLead.update({ where: { id }, data }));
  },

  /**
   * `expectedStatus` makes this a conditional (compare-and-swap) update —
   * `WHERE id = ? AND status = ?` — not a blind `update()`. Confirmed by
   * Codex's own Phase 5 security review (Build 19): reading `status`,
   * checking `VALID_TRANSITIONS` in application code, then writing
   * unconditionally is racy under two concurrent transitions off the
   * same starting status (e.g. QUALIFIED -> CONVERTED racing QUALIFIED
   * -> DISQUALIFIED could both pass their own read-time check). Returns
   * `null` (never throws) when the row's status has already moved out
   * from under the caller — `crm-lead-service.ts`'s own `changeLeadStatus()`
   * turns that into a `ConflictError`. `updateMany()`, not `update()`,
   * because Prisma's `update()` only accepts a unique `where` (`id`
   * alone), not a compound condition — the row is re-fetched afterward
   * since `updateMany()` doesn't return the updated row itself.
   */
  async changeStatus(
    id: string,
    status: CrmLeadStatus,
    expectedStatus: CrmLeadStatus,
    extra: { disqualifiedReason?: string | null; convertedAt?: Date | null } = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmLead | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmLead.updateMany({
        where: { id, status: expectedStatus },
        data: {
          status,
          disqualifiedReason: status === "DISQUALIFIED" ? (extra.disqualifiedReason ?? null) : null,
          convertedAt: status === "CONVERTED" ? (extra.convertedAt ?? new Date()) : undefined,
        },
      }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmLead.findUnique({ where: { id } }));
  },
};
