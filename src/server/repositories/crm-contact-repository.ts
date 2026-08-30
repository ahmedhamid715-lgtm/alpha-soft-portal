import "server-only";
import type { CrmContact, CrmContactStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export interface CrmContactListFilters {
  status?: CrmContactStatus;
  companyId?: string;
  search?: string;
}

/** Data access for `CrmContact` — RLS-protected. `companyId` is always a required FK (see schema.prisma) — a contact never exists without its company. */
export const crmContactRepository = {
  async create(
    input: { id: string; organizationId: string; companyId: string; firstName: string; lastName: string; email: string | null; phone: string | null; jobTitle: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmContact> {
    return withDbErrorTranslation(() =>
      tx.crmContact.create({
        data: { id: input.id, organizationId: input.organizationId, companyId: input.companyId, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, jobTitle: input.jobTitle },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContact | null> {
    return withDbErrorTranslation(() => tx.crmContact.findUnique({ where: { id } }));
  },

  async listForOrganization(
    organizationId: string,
    params: OffsetPaginationParams,
    filters: CrmContactListFilters = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<OffsetPaginatedResult<CrmContact>> {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.search
        ? { OR: [{ firstName: { contains: filters.search, mode: "insensitive" as const } }, { lastName: { contains: filters.search, mode: "insensitive" as const } }, { email: { contains: filters.search, mode: "insensitive" as const } }] }
        : {}),
    };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.crmContact.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.crmContact.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  /** Unbounded — a company's own contact roster, shown on the company detail page (bounded in practice by how many real contacts one company has, the same assumption `notifyAllActiveMembers()`'s own 500-cap documents for organization membership; revisit if this ever needs its own pagination). */
  async listForCompany(companyId: string, tx: TransactionClient | typeof db = db): Promise<CrmContact[]> {
    return withDbErrorTranslation(() => tx.crmContact.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 500 }));
  },

  async update(
    id: string,
    data: Partial<{ firstName: string; lastName: string; email: string | null; phone: string | null; jobTitle: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmContact> {
    return withDbErrorTranslation(() => tx.crmContact.update({ where: { id }, data }));
  },

  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContact> {
    return withDbErrorTranslation(() => tx.crmContact.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } }));
  },

  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContact> {
    return withDbErrorTranslation(() => tx.crmContact.update({ where: { id }, data: { status: "ACTIVE", archivedAt: null } }));
  },
};
