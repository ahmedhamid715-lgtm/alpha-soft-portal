import "server-only";
import type { CrmCustomFieldDefinition, CrmCustomFieldEntityType } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import type { Prisma } from "@/generated/prisma/client";

/** Data access for `CrmCustomFieldDefinition` — the CRM-scoped custom-field boundary (Roadmap 13's own scope), never the global cross-module Custom Fields Engine (Roadmap 64) — see crm-architecture.md "CRM custom-field boundary." Uniqueness on `(organizationId, entityType, key)` is a real DB constraint. */
export const crmCustomFieldDefinitionRepository = {
  async create(
    input: { id: string; organizationId: string; entityType: CrmCustomFieldEntityType; key: string; label: string; fieldType: CrmCustomFieldDefinition["fieldType"]; options: Prisma.InputJsonValue | undefined },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmCustomFieldDefinition> {
    return withDbErrorTranslation(() =>
      tx.crmCustomFieldDefinition.create({
        data: { id: input.id, organizationId: input.organizationId, entityType: input.entityType, key: input.key, label: input.label, fieldType: input.fieldType, options: input.options },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldDefinition | null> {
    return withDbErrorTranslation(() => tx.crmCustomFieldDefinition.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, entityType: CrmCustomFieldEntityType | undefined, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldDefinition[]> {
    return withDbErrorTranslation(() =>
      tx.crmCustomFieldDefinition.findMany({ where: { organizationId, ...(entityType ? { entityType } : {}) }, orderBy: { label: "asc" }, take: 500 }),
    );
  },

  async update(id: string, data: Partial<{ label: string; options: Prisma.InputJsonValue | undefined; isActive: boolean }>, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldDefinition> {
    return withDbErrorTranslation(() => tx.crmCustomFieldDefinition.update({ where: { id }, data }));
  },
};
