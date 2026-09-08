import "server-only";
import type { CrmClientOnboardingIntakeField, CrmClientOnboardingIntakeFieldStatus, CrmClientOnboardingIntakeFieldType, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CrmClientOnboardingIntakeField` — the tenant-wide, reusable intake field catalog (deliberately NOT a generic Forms Builder — see the model's own schema comment). Archiving, never deleting, matches `CrmProposalTemplate`'s own retirement pattern. */
export const crmClientOnboardingIntakeFieldRepository = {
  async create(
    input: { id: string; organizationId: string; label: string; fieldType: CrmClientOnboardingIntakeFieldType; required: boolean; options: string[] | null; sortOrder: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboardingIntakeField> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingIntakeField.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          label: input.label,
          fieldType: input.fieldType,
          required: input.required,
          options: input.options ? (input.options as Prisma.InputJsonValue) : undefined,
          sortOrder: input.sortOrder,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingIntakeField | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingIntakeField.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, status: CrmClientOnboardingIntakeFieldStatus | undefined, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingIntakeField[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingIntakeField.findMany({ where: { organizationId, ...(status ? { status } : {}) }, orderBy: { sortOrder: "asc" } }));
  },

  async setStatus(id: string, status: CrmClientOnboardingIntakeFieldStatus, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingIntakeField> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingIntakeField.update({ where: { id }, data: { status } }));
  },
};
