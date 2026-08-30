import "server-only";
import type { CrmPipeline } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CrmPipeline` — RLS-protected. A small, settings-style list per organization (bounded, no pagination — see sales-pipeline.md). "At most one default pipeline" is a real DB constraint (a hand-written partial unique index — Prisma can't express `@@unique` with a WHERE clause); a second default surfaces as `ConflictError` via `withDbErrorTranslation`'s own P2002 handling, not a pre-check here. */
export const crmPipelineRepository = {
  async create(input: { id: string; organizationId: string; name: string; isDefault: boolean }, tx: TransactionClient | typeof db = db): Promise<CrmPipeline> {
    return withDbErrorTranslation(() => tx.crmPipeline.create({ data: { id: input.id, organizationId: input.organizationId, name: input.name, isDefault: input.isDefault } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmPipeline | null> {
    return withDbErrorTranslation(() => tx.crmPipeline.findUnique({ where: { id } }));
  },

  async findDefault(organizationId: string, tx: TransactionClient | typeof db = db): Promise<CrmPipeline | null> {
    return withDbErrorTranslation(() => tx.crmPipeline.findFirst({ where: { organizationId, isDefault: true } }));
  },

  async listForOrganization(organizationId: string, filters: { status?: "ACTIVE" | "ARCHIVED" } = {}, tx: TransactionClient | typeof db = db): Promise<CrmPipeline[]> {
    return withDbErrorTranslation(() => tx.crmPipeline.findMany({ where: { organizationId, ...(filters.status ? { status: filters.status } : {}) }, orderBy: { createdAt: "asc" }, take: 200 }));
  },

  async update(id: string, data: Partial<{ name: string; isDefault: boolean }>, tx: TransactionClient | typeof db = db): Promise<CrmPipeline> {
    return withDbErrorTranslation(() => tx.crmPipeline.update({ where: { id }, data }));
  },

  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<CrmPipeline> {
    return withDbErrorTranslation(() => tx.crmPipeline.update({ where: { id }, data: { status: "ARCHIVED", isDefault: false } }));
  },

  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<CrmPipeline> {
    return withDbErrorTranslation(() => tx.crmPipeline.update({ where: { id }, data: { status: "ACTIVE" } }));
  },
};
