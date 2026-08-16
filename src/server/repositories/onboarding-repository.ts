import "server-only";
import type { OrganizationOnboarding } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `OrganizationOnboarding` (spec section 27). The actual
 * step vocabulary lives in `src/lib/organizations/onboarding.ts`, not
 * here — this repository just persists whatever `currentStep` string
 * the service layer gives it.
 */
export const onboardingRepository = {
  async create(
    input: { id: string; organizationId: string; currentStep: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationOnboarding> {
    return withDbErrorTranslation(() =>
      tx.organizationOnboarding.create({
        data: { id: input.id, organizationId: input.organizationId, currentStep: input.currentStep },
      }),
    );
  },

  async findByOrganizationId(
    organizationId: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationOnboarding | null> {
    return withDbErrorTranslation(() => tx.organizationOnboarding.findUnique({ where: { organizationId } }));
  },

  async updateStep(
    organizationId: string,
    input: { currentStep: string; completedAt?: Date | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationOnboarding> {
    return withDbErrorTranslation(() =>
      tx.organizationOnboarding.update({
        where: { organizationId },
        data: { currentStep: input.currentStep, ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}) },
      }),
    );
  },
};
