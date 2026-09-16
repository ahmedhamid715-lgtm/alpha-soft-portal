import "server-only";
import type { EcommerceProduct, EcommerceProductStatus, EcommerceProductSource } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";
import { ECOMMERCE_PRODUCT_READY_STATUSES } from "@/lib/ecommerce/product-lifecycle";

export interface EcommerceProductListFilters {
  status?: EcommerceProductStatus;
  search?: string;
}

export interface EcommerceProductCounts {
  productCount: number;
  requiredProductCount: number;
  completedRequiredProductCount: number;
}

function emptyCounts(): EcommerceProductCounts {
  return { productCount: 0, requiredProductCount: 0, completedRequiredProductCount: 0 };
}

/**
 * Data access for `EcommerceProduct` (Build 33 — Roadmap Module 27). No
 * DELETE grant — retired via `status = ARCHIVED`. Catalogs may be large
 * (10/1,000/100,000+ products) — `countsForStore()`/`countsForStores()`
 * apply Website Dev's own Build 32 Codex Performance Engineer finding
 * PERF-01 lesson FROM THE START (never as a follow-up): exact SQL
 * `groupBy` aggregates for KPI/readiness inputs, never a capped-row
 * fetch treated as an exact count.
 */
export const ecommerceProductRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      storeId: string;
      title: string;
      handle: string | null;
      externalProductId: string | null;
      productType: string | null;
      vendor: string | null;
      source: EcommerceProductSource;
      requiredForLaunch: boolean;
      sortOrder: number;
      primaryImageUrl: string | null;
      importBatchId: string | null;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<EcommerceProduct> {
    return withDbErrorTranslation(() => tx.ecommerceProduct.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceProduct | null> {
    return withDbErrorTranslation(() => tx.ecommerceProduct.findUnique({ where: { id } }));
  },

  async findByHandle(storeId: string, handle: string, tx: TransactionClient | typeof db = db): Promise<EcommerceProduct | null> {
    return withDbErrorTranslation(() => tx.ecommerceProduct.findFirst({ where: { storeId, handle } }));
  },

  async findByExternalProductId(storeId: string, externalProductId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceProduct | null> {
    return withDbErrorTranslation(() => tx.ecommerceProduct.findFirst({ where: { storeId, externalProductId } }));
  },

  async listForStore(storeId: string, params: OffsetPaginationParams, filters: EcommerceProductListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<EcommerceProduct>> {
    const where = { storeId, ...(filters.status ? { status: filters.status } : {}), ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" as const } } : {}) };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([tx.ecommerceProduct.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }), tx.ecommerceProduct.count({ where })]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Exact product/required-product/completed-required-product counts for one store — used by every KPI/readiness/launch-gate path, never by materializing product rows. */
  async countsForStore(storeId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceProductCounts> {
    const map = await this.countsForStores([storeId], tx);
    return map.get(storeId) ?? emptyCounts();
  },

  /** Batched across several stores at once — never one query per store, and never one global row cap shared across all stores. */
  async countsForStores(storeIds: string[], tx: TransactionClient | typeof db = db): Promise<Map<string, EcommerceProductCounts>> {
    const result = new Map<string, EcommerceProductCounts>();
    for (const storeId of storeIds) result.set(storeId, emptyCounts());
    if (storeIds.length === 0) return result;

    const rows = await withDbErrorTranslation(() => tx.ecommerceProduct.groupBy({ by: ["storeId", "requiredForLaunch", "status"], where: { storeId: { in: storeIds } }, _count: { _all: true } }));
    for (const row of rows) {
      const counts = result.get(row.storeId);
      if (!counts) continue;
      const n = row._count._all;
      counts.productCount += n;
      if (row.requiredForLaunch) {
        counts.requiredProductCount += n;
        if (ECOMMERCE_PRODUCT_READY_STATUSES.includes(row.status)) counts.completedRequiredProductCount += n;
      }
    }
    return result;
  },

  async update(id: string, data: Partial<{ title: string; handle: string | null; productType: string | null; vendor: string | null; requiredForLaunch: boolean; sortOrder: number; primaryImageUrl: string | null }>, tx: TransactionClient | typeof db = db): Promise<EcommerceProduct> {
    return withDbErrorTranslation(() => tx.ecommerceProduct.update({ where: { id }, data }));
  },

  /** CAS-guarded on the exact `from` status — closes a lost-update race between two concurrent lifecycle transitions on the same product. */
  async transition(id: string, from: EcommerceProductStatus, to: EcommerceProductStatus, tx: TransactionClient | typeof db = db): Promise<EcommerceProduct | null> {
    const result = await withDbErrorTranslation(() => tx.ecommerceProduct.updateMany({ where: { id, status: from }, data: { status: to } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ecommerceProduct.findUnique({ where: { id } }));
  },
};
