import "server-only";
import type { CustomerService, CustomerServiceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginationParams, OffsetPaginatedResult } from "@/lib/platform/pagination";
import { toOffsetPaginatedResult } from "@/lib/platform/pagination";

export interface CustomerServiceCreateInput {
  id: string;
  organizationId: string;
  customerOrganizationId: string;
  companyId: string;
  serviceDefinitionId: string;
  sourceOnboardingServiceItemId: string | null;
  quantity: number;
  ownerUserId: string | null;
  startDate: Date | null;
  targetEndDate: Date | null;
  createdByUserId: string;
}

export interface CustomerServiceListFilters {
  status?: CustomerServiceStatus;
  customerOrganizationId?: string;
  serviceDefinitionId?: string;
  ownerUserId?: string;
  search?: string;
}

/**
 * Data access for `CustomerService` (Build 29 — Roadmap Module 23) — one
 * real operational service engagement for one real customer. No DELETE
 * grant — same platform-wide discipline every other build's own tables
 * follow; a `CustomerService` is retained historical operational
 * evidence, terminal states (`COMPLETED`/`CANCELLED`) are never erased.
 */
export const customerServiceRepository = {
  async create(input: CustomerServiceCreateInput, tx: TransactionClient | typeof db = db): Promise<CustomerService> {
    return withDbErrorTranslation(() => tx.customerService.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },

  /** Row-locked read — used before a lifecycle transition so a concurrent transition on the same row serializes rather than interleaves (same reasoning `crmClientOnboardingRepository.findByIdLocked()`/`projectRepository.findByIdLocked()` already establish). */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<CustomerService | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM customer_services WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id: locked[0]!.id } }));
  },

  /** The DB-level idempotency guarantee's own read-side mirror — used to return the existing engagement (not error, not duplicate) on a repeat provisioning call. Excludes CANCELLED, matching the partial unique index's own WHERE clause exactly. */
  async findActiveForSourceItem(sourceOnboardingServiceItemId: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    return withDbErrorTranslation(() => tx.customerService.findFirst({ where: { sourceOnboardingServiceItemId, status: { not: "CANCELLED" } } }));
  },

  async listForOrganization(organizationId: string, params: OffsetPaginationParams, filters: CustomerServiceListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<CustomerService>> {
    const where = {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.customerOrganizationId ? { customerOrganizationId: filters.customerOrganizationId } : {}),
      ...(filters.serviceDefinitionId ? { serviceDefinitionId: filters.serviceDefinitionId } : {}),
      ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
      ...(filters.search ? { serviceDefinition: { name: { contains: filters.search, mode: "insensitive" as const } } } : {}),
    };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.customerService.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.customerService.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Every `CustomerService` for one `CrmCompany` — Customer 360's own bounded per-company read, never a full-organization scan. */
  async listForCompany(companyId: string, tx: TransactionClient | typeof db = db): Promise<CustomerService[]> {
    return withDbErrorTranslation(() => tx.customerService.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50 }));
  },

  /** Every `CustomerService` for one customer `Organization` — the Portal's own bounded per-customer read. */
  async listForCustomerOrganization(customerOrganizationId: string, tx: TransactionClient | typeof db = db): Promise<CustomerService[]> {
    return withDbErrorTranslation(() => tx.customerService.findMany({ where: { customerOrganizationId }, orderBy: { createdAt: "desc" }, take: 50 }));
  },

  async update(id: string, data: Partial<{ ownerUserId: string | null; startDate: Date | null; targetEndDate: Date | null; quantity: number }>, tx: TransactionClient | typeof db = db): Promise<CustomerService> {
    return withDbErrorTranslation(() => tx.customerService.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status = PENDING`. */
  async activate(id: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    const result = await withDbErrorTranslation(() => tx.customerService.updateMany({ where: { id, status: "PENDING" }, data: { status: "ACTIVE", activatedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = COMPLETED` — the "reopen" edge. Clears the stale completion fact, same discipline every reopen in this codebase follows. */
  async reopen(id: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    const result = await withDbErrorTranslation(() => tx.customerService.updateMany({ where: { id, status: "COMPLETED" }, data: { status: "ACTIVE", completedAt: null } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ACTIVE`. */
  async pause(id: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    const result = await withDbErrorTranslation(() => tx.customerService.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "PAUSED", pausedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = PAUSED`. */
  async resume(id: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    const result = await withDbErrorTranslation(() => tx.customerService.updateMany({ where: { id, status: "PAUSED" }, data: { status: "ACTIVE" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ACTIVE`. */
  async complete(id: string, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    const result = await withDbErrorTranslation(() => tx.customerService.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status IN (PENDING, ACTIVE, PAUSED)` — every non-terminal status. */
  async cancel(id: string, data: { cancelledReason: string; cancelledByUserId: string }, tx: TransactionClient | typeof db = db): Promise<CustomerService | null> {
    const result = await withDbErrorTranslation(() => tx.customerService.updateMany({ where: { id, status: { in: ["PENDING", "ACTIVE", "PAUSED"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), ...data } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.customerService.findUnique({ where: { id } }));
  },
};
