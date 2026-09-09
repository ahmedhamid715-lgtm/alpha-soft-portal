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

  /** Build 25 (Client Success) — the reverse lookup a bulk, org-wide payment-risk scan needs: given a bounded set of already-identified at-risk linked-organization ids, resolve which `CrmCompany` each belongs to. One query, never a per-organization loop. */
  async listByConvertedOrganizationIds(organizationId: string, convertedToOrganizationIds: string[], tx: TransactionClient | typeof db = db): Promise<CrmCompany[]> {
    if (convertedToOrganizationIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.crmCompany.findMany({ where: { organizationId, convertedToOrganizationId: { in: convertedToOrganizationIds } } }));
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

  /**
   * Build 23 — the ONE write path for `convertedToOrganizationId`. A real
   * CAS: guarded on `convertedToOrganizationId IS NULL`, so a concurrent
   * double-conversion attempt for the same company can only ever win
   * once — the loser gets `count === 0` back (never a thrown unique-
   * constraint error from the database's own `crm_companies_converted_to_
   * organization_id_key`, which exists as a second, structural layer of
   * the same guarantee, not the primary mechanism the service layer
   * relies on). See `convertDealToClient()`'s own comment for how the
   * caller uses this to detect and recover from a lost race (delete its
   * own just-created, now-orphaned Organization and reuse the winner's).
   */
  async linkToOrganization(id: string, organizationId: string, tx: TransactionClient): Promise<CrmCompany | null> {
    const result = await withDbErrorTranslation(() => tx.crmCompany.updateMany({ where: { id, convertedToOrganizationId: null }, data: { convertedToOrganizationId: organizationId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmCompany.findUnique({ where: { id } }));
  },
};
