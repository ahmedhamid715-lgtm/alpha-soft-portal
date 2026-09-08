import "server-only";
import type { CrmClientOnboardingIntakeResponse } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `CrmClientOnboardingIntakeResponse` — one response per
 * field per onboarding (`@@unique([onboardingId, fieldId])`). `upsert()`
 * is the ONLY write here — deliberately, so a correction never needs a
 * delete (no DELETE grant exists on this table; see the model's own
 * schema comment for why this domain is designed to never need one).
 */
export const crmClientOnboardingIntakeResponseRepository = {
  async upsert(
    input: { organizationId: string; onboardingId: string; fieldId: string; value: string | null; respondedByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingIntakeResponse> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingIntakeResponse.upsert({
        where: { onboardingId_fieldId: { onboardingId: input.onboardingId, fieldId: input.fieldId } },
        create: {
          id: crypto.randomUUID(),
          organizationId: input.organizationId,
          onboardingId: input.onboardingId,
          fieldId: input.fieldId,
          value: input.value,
          respondedByUserId: input.respondedByUserId,
          respondedAt: new Date(),
        },
        update: { value: input.value, respondedByUserId: input.respondedByUserId, respondedAt: new Date() },
      }),
    );
  },

  async listForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingIntakeResponse[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingIntakeResponse.findMany({ where: { onboardingId } }));
  },
};
