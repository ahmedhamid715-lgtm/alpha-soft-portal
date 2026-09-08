import "server-only";
import type { CrmProposalLineItem, CrmProposalDiscountType } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Shape for a line item to persist, without the id/organizationId/versionId the repository itself supplies. */
export interface CrmProposalLineItemWithoutIds {
  title: string;
  description: string | null;
  quantity: number;
  unitAmountMinorUnits: number;
  discountType: CrmProposalDiscountType;
  discountValue: number | null;
  lineTotalMinorUnits: number;
  sortOrder: number;
}

/**
 * Data access for `CrmProposalLineItem` — RLS-protected, with its own
 * subquery-based INSERT/UPDATE policies requiring the OWNING version to
 * still be DRAFT (line items have no lifecycle of their own; they live
 * or die with their version's own DRAFT state, so a plain RLS `USING`/
 * `WITH CHECK` subquery is precise here — unlike the version row itself,
 * a line item never needs a post-DRAFT write of any kind).
 */
export const crmProposalLineItemRepository = {
  /** Replaces the full set of line items for a still-DRAFT version — always called inside the same transaction as the version's own `updateDraftContent()`/pricing recompute. */
  async replaceForVersion(versionId: string, organizationId: string, items: CrmProposalLineItemWithoutIds[], tx: TransactionClient): Promise<CrmProposalLineItem[]> {
    return withDbErrorTranslation(async () => {
      await tx.crmProposalLineItem.deleteMany({ where: { versionId } });
      if (items.length === 0) return [];
      await tx.crmProposalLineItem.createMany({
        data: items.map((item, index) => ({
          id: crypto.randomUUID(),
          organizationId,
          versionId,
          title: item.title,
          description: item.description,
          quantity: item.quantity,
          unitAmountMinorUnits: item.unitAmountMinorUnits,
          discountType: item.discountType,
          discountValue: item.discountValue,
          lineTotalMinorUnits: item.lineTotalMinorUnits,
          sortOrder: item.sortOrder ?? index,
        })),
      });
      return tx.crmProposalLineItem.findMany({ where: { versionId }, orderBy: { sortOrder: "asc" } });
    });
  },

  async listForVersion(versionId: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalLineItem[]> {
    return withDbErrorTranslation(() => tx.crmProposalLineItem.findMany({ where: { versionId }, orderBy: { sortOrder: "asc" } }));
  },

  async listForVersions(versionIds: string[], tx: TransactionClient | typeof db = db): Promise<CrmProposalLineItem[]> {
    if (versionIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.crmProposalLineItem.findMany({ where: { versionId: { in: versionIds } }, orderBy: [{ versionId: "asc" }, { sortOrder: "asc" }] }));
  },
};
