import "server-only";
import type { CrmDealHistory, CrmDealHistoryType, Prisma, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export type CrmDealHistoryWithActor = CrmDealHistory & { actorUser: Pick<User, "id" | "name" | "email"> };

const ACTOR_SELECT = { id: true, name: true, email: true } as const;

/** Data access for `CrmDealHistory` — RLS-protected, IMMUTABLE (SELECT + INSERT only, no UPDATE/DELETE policy, no `update`/`archive` method here at all — see the migration's own RLS comment and sales-pipeline.md "Deal history"). System-generated entries carry `metadata`; the one user-authorable type (`NOTE`) carries `note` instead. */
export const crmDealHistoryRepository = {
  async create(
    input: { id: string; organizationId: string; dealId: string; type: CrmDealHistoryType; metadata: Prisma.InputJsonValue | undefined; note: string | null; actorUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmDealHistory> {
    return withDbErrorTranslation(() =>
      tx.crmDealHistory.create({
        data: { id: input.id, organizationId: input.organizationId, dealId: input.dealId, type: input.type, metadata: input.metadata, note: input.note, actorUserId: input.actorUserId },
      }),
    );
  },

  async listForDeal(dealId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<CrmDealHistoryWithActor>> {
    const where = { dealId };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmDealHistory.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit, include: { actorUser: { select: ACTOR_SELECT } } }),
        tx.crmDealHistory.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },
};
