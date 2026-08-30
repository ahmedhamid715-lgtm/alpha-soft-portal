import "server-only";
import type { CrmActivity, CrmActivityType, CrmCallOutcome, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export type CrmActivityWithActor = CrmActivity & { actorUser: Pick<User, "id" | "name" | "email"> };

const ACTOR_SELECT = { id: true, name: true, email: true } as const;

/** Data access for `CrmActivity` — RLS-protected, IMMUTABLE (SELECT + INSERT only, no UPDATE policy, no `update`/`archive` method here at all — see the migration's own RLS comment and crm-architecture.md "Activities are immutable"). Exactly one of `leadId`/`companyId`/`contactId` is set, enforced by a DB CHECK constraint — never assume more than one caller-supplied parent id. */
export const crmActivityRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      leadId: string | null;
      companyId: string | null;
      contactId: string | null;
      type: CrmActivityType;
      body: string | null;
      callDurationSeconds: number | null;
      callOutcome: CrmCallOutcome | null;
      actorUserId: string;
      occurredAt?: Date;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmActivity> {
    return withDbErrorTranslation(() =>
      tx.crmActivity.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          leadId: input.leadId,
          companyId: input.companyId,
          contactId: input.contactId,
          type: input.type,
          body: input.body,
          callDurationSeconds: input.callDurationSeconds,
          callOutcome: input.callOutcome,
          actorUserId: input.actorUserId,
          occurredAt: input.occurredAt ?? new Date(),
        },
      }),
    );
  },

  // Each `list*` below joins `actorUser` (id/name/email only) so the
  // timeline UI (`components/crm/activity-list.tsx`, reusing the shared
  // `ActivityTimeline`) never has to N+1-fetch actor names itself.

  async listForLead(leadId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<CrmActivityWithActor>> {
    const where = { leadId };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmActivity.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit, include: { actorUser: { select: ACTOR_SELECT } } }),
        tx.crmActivity.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async listForCompany(companyId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<CrmActivityWithActor>> {
    const where = { companyId };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmActivity.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit, include: { actorUser: { select: ACTOR_SELECT } } }),
        tx.crmActivity.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async listForContact(contactId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<CrmActivityWithActor>> {
    const where = { contactId };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmActivity.findMany({ where, orderBy: { occurredAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit, include: { actorUser: { select: ACTOR_SELECT } } }),
        tx.crmActivity.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },
};
