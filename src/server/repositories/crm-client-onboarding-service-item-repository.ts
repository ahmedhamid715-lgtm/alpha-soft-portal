import "server-only";
import type { CrmClientOnboardingServiceItem } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface CrmClientOnboardingServiceItemInput {
  title: string;
  description: string | null;
  quantity: number;
  sourceLineItemId: string | null;
  onboardingRequired: boolean;
  notes: string | null;
}

/**
 * Data access for `CrmClientOnboardingServiceItem` — a snapshot of one
 * sold service line for onboarding purposes, never a live reference into
 * the immutable accepted proposal version (see the model's own schema
 * comment). Written ONCE, at conversion time, via `createMany()` — never
 * deleted or wholesale-replaced afterward (no DELETE grant exists on this
 * table), only `update()` for onboarding-only operational fields.
 */
export const crmClientOnboardingServiceItemRepository = {
  async createMany(onboardingId: string, organizationId: string, items: CrmClientOnboardingServiceItemInput[], tx: TransactionClient): Promise<void> {
    if (items.length === 0) return;
    await withDbErrorTranslation(() =>
      tx.crmClientOnboardingServiceItem.createMany({
        data: items.map((item, index) => ({
          id: crypto.randomUUID(),
          organizationId,
          onboardingId,
          title: item.title,
          description: item.description,
          quantity: item.quantity,
          sourceLineItemId: item.sourceLineItemId,
          onboardingRequired: item.onboardingRequired,
          notes: item.notes,
          sortOrder: index,
        })),
      }),
    );
  },

  async listForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingServiceItem[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingServiceItem.findMany({ where: { onboardingId }, orderBy: { sortOrder: "asc" } }));
  },

  async update(id: string, data: Partial<{ onboardingRequired: boolean; notes: string | null }>, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingServiceItem> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingServiceItem.update({ where: { id }, data }));
  },
};
