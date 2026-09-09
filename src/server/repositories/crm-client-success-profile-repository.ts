import "server-only";
import type { CrmClientSuccessProfile } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `CrmClientSuccessProfile` — one row per `CrmCompany`,
 * created lazily (see the model's own schema comment). Every write is an
 * `upsert()` — never a bare `create()` followed by a separate `update()`
 * path — since the row may or may not already exist and this domain is
 * deliberately DELETE-free, the same discipline every other Build 23/25
 * table follows.
 */
export const crmClientSuccessProfileRepository = {
  async findByCompanyId(companyId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessProfile | null> {
    return withDbErrorTranslation(() => tx.crmClientSuccessProfile.findUnique({ where: { companyId } }));
  },

  async setOwner(input: { id: string; organizationId: string; companyId: string; csOwnerUserId: string | null }, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessProfile> {
    return withDbErrorTranslation(() =>
      tx.crmClientSuccessProfile.upsert({
        where: { companyId: input.companyId },
        create: { id: input.id, organizationId: input.organizationId, companyId: input.companyId, csOwnerUserId: input.csOwnerUserId },
        update: { csOwnerUserId: input.csOwnerUserId },
      }),
    );
  },

  async setManagementAttention(
    input: { id: string; organizationId: string; companyId: string; flag: boolean; reason: string | null; setByUserId: string | null; setAt: Date | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientSuccessProfile> {
    return withDbErrorTranslation(() =>
      tx.crmClientSuccessProfile.upsert({
        where: { companyId: input.companyId },
        create: {
          id: input.id,
          organizationId: input.organizationId,
          companyId: input.companyId,
          managementAttentionFlag: input.flag,
          managementAttentionReason: input.reason,
          managementAttentionSetByUserId: input.setByUserId,
          managementAttentionSetAt: input.setAt,
        },
        update: {
          managementAttentionFlag: input.flag,
          managementAttentionReason: input.reason,
          managementAttentionSetByUserId: input.setByUserId,
          managementAttentionSetAt: input.setAt,
        },
      }),
    );
  },
};
