import "server-only";
import type { CrmCustomFieldValue } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { generateId } from "@/lib/utils/id";

export interface CrmCustomFieldValueInput {
  valueText: string | null;
  valueNumber: string | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
}

/**
 * Data access for `CrmCustomFieldValue`. No direct `organizationId` column
 * (owned transitively via `definitionId` — see the model's own schema
 * comment and the migration's one-hop RLS policy) — every real call must
 * still run inside `withTenantContext()` for RLS to apply through that
 * join. There's no DB-level uniqueness on `(definitionId, <entity>)`
 * (see crm-architecture.md), so `upsertFor*` below does an explicit
 * find-then-write rather than relying on a Prisma `upsert`'s WHERE.
 */
export const crmCustomFieldValueRepository = {
  async listForLead(leadId: string, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldValue[]> {
    return withDbErrorTranslation(() => tx.crmCustomFieldValue.findMany({ where: { leadId }, take: 500 }));
  },

  async listForCompany(companyId: string, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldValue[]> {
    return withDbErrorTranslation(() => tx.crmCustomFieldValue.findMany({ where: { companyId }, take: 500 }));
  },

  async listForContact(contactId: string, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldValue[]> {
    return withDbErrorTranslation(() => tx.crmCustomFieldValue.findMany({ where: { contactId }, take: 500 }));
  },

  async upsertForLead(definitionId: string, leadId: string, value: CrmCustomFieldValueInput, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldValue> {
    return upsert({ definitionId, leadId, companyId: null, contactId: null }, value, tx);
  },

  async upsertForCompany(definitionId: string, companyId: string, value: CrmCustomFieldValueInput, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldValue> {
    return upsert({ definitionId, leadId: null, companyId, contactId: null }, value, tx);
  },

  async upsertForContact(definitionId: string, contactId: string, value: CrmCustomFieldValueInput, tx: TransactionClient | typeof db = db): Promise<CrmCustomFieldValue> {
    return upsert({ definitionId, leadId: null, companyId: null, contactId }, value, tx);
  },
};

async function upsert(
  target: { definitionId: string; leadId: string | null; companyId: string | null; contactId: string | null },
  value: CrmCustomFieldValueInput,
  tx: TransactionClient | typeof db,
): Promise<CrmCustomFieldValue> {
  return withDbErrorTranslation(async () => {
    const existing = await tx.crmCustomFieldValue.findFirst({ where: target });
    const data = { valueText: value.valueText, valueNumber: value.valueNumber, valueDate: value.valueDate, valueBoolean: value.valueBoolean };
    if (existing) return tx.crmCustomFieldValue.update({ where: { id: existing.id }, data });
    return tx.crmCustomFieldValue.create({ data: { id: generateId(), ...target, ...data } });
  });
}
