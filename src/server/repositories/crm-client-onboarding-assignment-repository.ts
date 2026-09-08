import "server-only";
import type { CrmClientOnboardingAssignment, CrmClientOnboardingAssignmentRole, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmClientOnboardingAssignmentWithUser = CrmClientOnboardingAssignment & { user: Pick<User, "id" | "name"> };

/**
 * Data access for `CrmClientOnboardingAssignment` — at most one person per
 * role per onboarding (`@@unique([onboardingId, role])`). Reassigning a
 * role is an `upsert()` — update the existing role-row's `userId` in
 * place, never delete-then-recreate (no DELETE grant on this table; same
 * "design the write pattern so DELETE is never needed" discipline every
 * other Build 23 table follows).
 */
export const crmClientOnboardingAssignmentRepository = {
  async upsert(
    input: { organizationId: string; onboardingId: string; role: CrmClientOnboardingAssignmentRole; userId: string; assignedByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingAssignment> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingAssignment.upsert({
        where: { onboardingId_role: { onboardingId: input.onboardingId, role: input.role } },
        create: {
          id: crypto.randomUUID(),
          organizationId: input.organizationId,
          onboardingId: input.onboardingId,
          role: input.role,
          userId: input.userId,
          assignedByUserId: input.assignedByUserId,
        },
        update: { userId: input.userId, assignedByUserId: input.assignedByUserId, assignedAt: new Date() },
      }),
    );
  },

  async listForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingAssignmentWithUser[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingAssignment.findMany({ where: { onboardingId }, include: { user: { select: { id: true, name: true } } }, orderBy: { role: "asc" } }));
  },
};
