import "server-only";
import type { CrmSalesTeamMember, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmSalesTeamMemberWithUser = CrmSalesTeamMember & {
  user: Pick<User, "id" | "name" | "email" | "status">;
  manager: (Pick<CrmSalesTeamMember, "id"> & { user: Pick<User, "id" | "name"> }) | null;
};

const WITH_USER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, status: true } },
  manager: { select: { id: true, user: { select: { id: true, name: true } } } },
} as const;

/**
 * Data access for `CrmSalesTeamMember` — RLS-protected. Membership is
 * ACTIVE/INACTIVE, never deleted (`archive()` sets INACTIVE + `leftAt`) —
 * see the schema's own comment for why a rep who rejoins gets a NEW row
 * rather than a reactivated one. Bounded to 200 rows everywhere (a real
 * internal sales team is far smaller than that, the same realistic-size
 * assumption `crmPipelineRepository.listForOrganization()` already
 * documents for pipelines).
 */
export const crmSalesTeamMemberRepository = {
  async create(
    input: { id: string; organizationId: string; userId: string; managerId: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmSalesTeamMember> {
    return withDbErrorTranslation(() =>
      tx.crmSalesTeamMember.create({ data: { id: input.id, organizationId: input.organizationId, userId: input.userId, managerId: input.managerId } }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMember | null> {
    return withDbErrorTranslation(() => tx.crmSalesTeamMember.findUnique({ where: { id } }));
  },

  /** Batched form of `findById()` — for `getGoalAttainments()`'s own batched attainment computation, one query instead of one per goal. */
  async findByIds(ids: string[], tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMember[]> {
    if (ids.length === 0) return [];
    return withDbErrorTranslation(() => tx.crmSalesTeamMember.findMany({ where: { id: { in: ids } } }));
  },

  async findByIdWithUser(id: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMemberWithUser | null> {
    return withDbErrorTranslation(() => tx.crmSalesTeamMember.findUnique({ where: { id }, include: WITH_USER_INCLUDE }));
  },

  /** The one ACTIVE row for `(organizationId, userId)`, if any — the real gate for "is this user currently on the sales team." */
  async findActiveByOrgAndUser(organizationId: string, userId: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMember | null> {
    return withDbErrorTranslation(() => tx.crmSalesTeamMember.findFirst({ where: { organizationId, userId, status: "ACTIVE" } }));
  },

  async listForOrganization(
    organizationId: string,
    filters: { status?: "ACTIVE" | "INACTIVE" } = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmSalesTeamMemberWithUser[]> {
    return withDbErrorTranslation(() =>
      tx.crmSalesTeamMember.findMany({
        where: { organizationId, ...(filters.status ? { status: filters.status } : {}) },
        include: WITH_USER_INCLUDE,
        orderBy: { joinedAt: "asc" },
        take: 200,
      }),
    );
  },

  /** Direct reports of one manager — for the manager's own "my team" view. */
  async listDirectReports(managerId: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMemberWithUser[]> {
    return withDbErrorTranslation(() =>
      tx.crmSalesTeamMember.findMany({ where: { managerId, status: "ACTIVE" }, include: WITH_USER_INCLUDE, orderBy: { joinedAt: "asc" }, take: 200 }),
    );
  },

  async setManager(id: string, managerId: string | null, tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMember> {
    return withDbErrorTranslation(() => tx.crmSalesTeamMember.update({ where: { id }, data: { managerId } }));
  },

  /** Removal — INACTIVE + `leftAt`, never a hard delete (RLS has no DELETE policy on this table at all). */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesTeamMember> {
    return withDbErrorTranslation(() => tx.crmSalesTeamMember.update({ where: { id }, data: { status: "INACTIVE", leftAt: new Date() } }));
  },
};
