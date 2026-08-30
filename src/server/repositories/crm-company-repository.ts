import "server-only";
import type { CrmCompany, CrmCompanyStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export interface CrmCompanyListFilters {
  status?: CrmCompanyStatus;
  search?: string;
}

/** Data access for `CrmCompany` — RLS-protected; every real call runs inside `withTenantContext()`. Every row belongs to the one platform organization (see crm-architecture.md) — `organizationId` is always the caller's already-verified platform organization id, never a customer org. */
export const crmCompanyRepository = {
  async create(
    input: { id: string; organizationId: string; name: string; domain: string | null; industry: string | null; website: string | null; phone: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmCompany> {
    return withDbErrorTranslation(() =>
      tx.crmCompany.create({
        data: { id: input.id, organizationId: input.organizationId, name: input.name, domain: input.domain, industry: input.industry, website: input.website, phone: input.phone },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmCompany | null> {
    return withDbErrorTranslation(() => tx.crmCompany.findUnique({ where: { id } }));
  },

  async listForOrganization(
    organizationId: string,
    params: OffsetPaginationParams,
    filters: CrmCompanyListFilters = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<OffsetPaginatedResult<CrmCompany>> {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmCompany.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.crmCompany.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async update(
    id: string,
    data: Partial<{ name: string; domain: string | null; industry: string | null; website: string | null; phone: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmCompany> {
    return withDbErrorTranslation(() => tx.crmCompany.update({ where: { id }, data }));
  },

  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<CrmCompany> {
    return withDbErrorTranslation(() => tx.crmCompany.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } }));
  },

  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<CrmCompany> {
    return withDbErrorTranslation(() => tx.crmCompany.update({ where: { id }, data: { status: "ACTIVE", archivedAt: null } }));
  },
};
