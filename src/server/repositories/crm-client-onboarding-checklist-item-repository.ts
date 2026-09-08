import "server-only";
import type { CrmClientOnboardingChecklistItem } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CrmClientOnboardingChecklistItem` — onboarding-scoped, not global Task Management (see the model's own schema comment). No dependency graph. */
export const crmClientOnboardingChecklistItemRepository = {
  async create(
    input: { id: string; organizationId: string; onboardingId: string; title: string; description: string | null; required: boolean; assignedToUserId: string | null; dueDate: Date | null; sortOrder: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingChecklistItem> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingChecklistItem.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          onboardingId: input.onboardingId,
          title: input.title,
          description: input.description,
          required: input.required,
          assignedToUserId: input.assignedToUserId,
          dueDate: input.dueDate,
          sortOrder: input.sortOrder,
        },
      }),
    );
  },

  /** Used for the built-in default-checklist seed inside the conversion transaction — mirrors `crmProposalLineItemRepository.replaceForVersion()`'s own `createMany()` shape. */
  async createMany(onboardingId: string, organizationId: string, items: { title: string; description: string | null; required: boolean }[], tx: TransactionClient): Promise<void> {
    if (items.length === 0) return;
    await withDbErrorTranslation(() =>
      tx.crmClientOnboardingChecklistItem.createMany({
        data: items.map((item, index) => ({
          id: crypto.randomUUID(),
          organizationId,
          onboardingId,
          title: item.title,
          description: item.description,
          required: item.required,
          sortOrder: index,
        })),
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingChecklistItem | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.findUnique({ where: { id } }));
  },

  async listForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingChecklistItem[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.findMany({ where: { onboardingId }, orderBy: { sortOrder: "asc" } }));
  },

  /** Used only to derive a new row's `sortOrder` — a plain `count()`, not the full `listForOnboarding()` (Codex Performance Engineer review: creating a checklist item was fetching every existing row just to read `.length`). */
  async countForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.count({ where: { onboardingId } }));
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; required: boolean; assignedToUserId: string | null; dueDate: Date | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingChecklistItem> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status <> 'COMPLETE'` — idempotent/race-safe completion, same discipline as `crmClientOnboardingRequirementRepository.complete()`. */
  async complete(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingChecklistItem | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.updateMany({ where: { id, status: { not: "COMPLETE" } }, data: { status: "COMPLETE", completedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.findUnique({ where: { id } }));
  },

  /** Reopen a completed item — the one legitimate non-CAS-terminal write; status moves back to PENDING, `completedAt` cleared. */
  async reopen(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingChecklistItem> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingChecklistItem.update({ where: { id }, data: { status: "PENDING", completedAt: null } }));
  },
};
