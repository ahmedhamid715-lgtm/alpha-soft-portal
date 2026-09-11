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

  /** Build 29 (Service Management) — provisioning's own single-row lookup by id, never previously needed by Build 23's own onboarding-scoped reads. */
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingServiceItem | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingServiceItem.findUnique({ where: { id } }));
  },

  /**
   * Build 29 (Service Management) — every onboarding service item for
   * this platform organization with NO active (non-`CANCELLED`)
   * `CustomerService` yet provisioned from it — the real "unmapped
   * historical services" list, computed directly from the relation,
   * never a separate flag/field that could drift out of sync with the
   * actual provisioning state. Bounded to 200, same realistic-total
   * assumption every other cross-record list in this codebase
   * documents. Includes the parent onboarding's own linked-organization
   * name for display context.
   */
  async listUnprovisioned(organizationId: string, tx: TransactionClient | typeof db = db): Promise<(CrmClientOnboardingServiceItem & { onboarding: { id: string; linkedOrganization: { displayName: string } } })[]> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingServiceItem.findMany({
        where: { organizationId, customerServicesProvisioned: { none: { status: { not: "CANCELLED" } } } },
        include: { onboarding: { select: { id: true, linkedOrganization: { select: { displayName: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  },

  async update(id: string, data: Partial<{ onboardingRequired: boolean; notes: string | null }>, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingServiceItem> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingServiceItem.update({ where: { id }, data }));
  },
};
