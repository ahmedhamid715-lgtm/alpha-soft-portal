import "server-only";
import type { CrmLeadSource } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CrmLeadSource` — a small, settings-style list per organization (bounded, no pagination — see crm-architecture.md "Lead sources"). Uniqueness on `(organizationId, name)` is a real DB constraint; a duplicate name surfaces as `ConflictError` via `withDbErrorTranslation`'s own P2002 handling, not a pre-check here. */
export const crmLeadSourceRepository = {
  async create(input: { id: string; organizationId: string; name: string }, tx: TransactionClient | typeof db = db): Promise<CrmLeadSource> {
    return withDbErrorTranslation(() => tx.crmLeadSource.create({ data: { id: input.id, organizationId: input.organizationId, name: input.name } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmLeadSource | null> {
    return withDbErrorTranslation(() => tx.crmLeadSource.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, tx: TransactionClient | typeof db = db): Promise<CrmLeadSource[]> {
    return withDbErrorTranslation(() => tx.crmLeadSource.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 500 }));
  },

  async update(id: string, data: Partial<{ name: string; isActive: boolean }>, tx: TransactionClient | typeof db = db): Promise<CrmLeadSource> {
    return withDbErrorTranslation(() => tx.crmLeadSource.update({ where: { id }, data }));
  },
};
