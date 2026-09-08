import "server-only";
import type { CrmClientOnboardingRequirement, CrmClientOnboardingRequirementStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CrmClientOnboardingRequirement` — onboarding-scoped, not global Task Management (see the model's own schema comment). */
export const crmClientOnboardingRequirementRepository = {
  async create(
    input: { id: string; organizationId: string; onboardingId: string; title: string; description: string | null; required: boolean; responsibleUserId: string | null; dueDate: Date | null; sortOrder: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingRequirement> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingRequirement.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          onboardingId: input.onboardingId,
          title: input.title,
          description: input.description,
          required: input.required,
          responsibleUserId: input.responsibleUserId,
          dueDate: input.dueDate,
          sortOrder: input.sortOrder,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingRequirement | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.findUnique({ where: { id } }));
  },

  async listForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingRequirement[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.findMany({ where: { onboardingId }, orderBy: { sortOrder: "asc" } }));
  },

  /** Used only to derive a new row's `sortOrder` — a plain `count()`, not the full `listForOnboarding()` (Codex Performance Engineer review: creating a requirement was fetching every existing row just to read `.length`). */
  async countForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.count({ where: { onboardingId } }));
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; required: boolean; responsibleUserId: string | null; dueDate: Date | null; documentId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingRequirement> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status <> 'COMPLETE'` — idempotent/race-safe completion (a lost race returns `null`, never a duplicate completion timestamp). */
  async complete(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingRequirement | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.updateMany({ where: { id, status: { not: "COMPLETE" } }, data: { status: "COMPLETE", completedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.findUnique({ where: { id } }));
  },

  async setStatus(id: string, status: CrmClientOnboardingRequirementStatus, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingRequirement> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingRequirement.update({ where: { id }, data: { status, completedAt: status === "COMPLETE" ? new Date() : null } }));
  },
};
