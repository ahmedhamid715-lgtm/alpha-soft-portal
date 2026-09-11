import "server-only";
import type { ServiceDefinition, ServiceDefinitionStatus, ServiceCategory } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface ServiceDefinitionListFilters {
  status?: ServiceDefinitionStatus;
  category?: ServiceCategory;
  search?: string;
}

/**
 * Data access for `ServiceDefinition` (Build 29 — Roadmap Module 23) —
 * the platform's own service catalog. No DELETE grant — same
 * platform-wide discipline every other build's own tables follow;
 * retirement is `archive()`, never a hard delete (existing
 * `CustomerService` rows keep a valid `Restrict`-protected FK
 * reference regardless).
 */
export const serviceDefinitionRepository = {
  async create(
    input: { id: string; organizationId: string; name: string; code: string; description: string | null; category: ServiceCategory; deliveryCadence: "ONE_TIME" | "RECURRING" | "ONGOING"; sortOrder: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<ServiceDefinition> {
    return withDbErrorTranslation(() => tx.serviceDefinition.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ServiceDefinition | null> {
    return withDbErrorTranslation(() => tx.serviceDefinition.findUnique({ where: { id } }));
  },

  async findByCode(organizationId: string, code: string, tx: TransactionClient | typeof db = db): Promise<ServiceDefinition | null> {
    return withDbErrorTranslation(() => tx.serviceDefinition.findUnique({ where: { organizationId_code: { organizationId, code } } }));
  },

  /** Bounded to 200 — the realistic-total assumption every other tenant-wide catalog list in this codebase documents (a real service catalog has dozens of entries, not thousands). Ordered by `sortOrder` for staff-controlled display order, never alphabetical/creation-order only. */
  async listAll(organizationId: string, filters: ServiceDefinitionListFilters, tx: TransactionClient | typeof db = db): Promise<ServiceDefinition[]> {
    return withDbErrorTranslation(() =>
      tx.serviceDefinition.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: 200,
      }),
    );
  },

  /** Every `ACTIVE` definition, for pickers (provisioning/manual-creation forms) — a narrower, more frequent query than `listAll()`, kept separate so a picker never accidentally shows an archived option. */
  async listActive(organizationId: string, tx: TransactionClient | typeof db = db): Promise<ServiceDefinition[]> {
    return withDbErrorTranslation(() => tx.serviceDefinition.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 200 }));
  },

  async update(
    id: string,
    data: Partial<{ name: string; description: string | null; category: ServiceCategory; deliveryCadence: "ONE_TIME" | "RECURRING" | "ONGOING"; sortOrder: number }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<ServiceDefinition> {
    return withDbErrorTranslation(() => tx.serviceDefinition.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status = ACTIVE` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<ServiceDefinition | null> {
    const result = await withDbErrorTranslation(() => tx.serviceDefinition.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED", archivedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.serviceDefinition.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — a lost race (already active) returns `null`. */
  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<ServiceDefinition | null> {
    const result = await withDbErrorTranslation(() => tx.serviceDefinition.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE", archivedAt: null } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.serviceDefinition.findUnique({ where: { id } }));
  },
};
