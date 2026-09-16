import "server-only";
import type { EcommerceCollection, EcommerceCollectionProduct, EcommerceProductStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `EcommerceCollection` (Build 33 — Roadmap Module 27). No DELETE grant — retired via `status = ARCHIVED`. */
export const ecommerceCollectionRepository = {
  async create(input: { id: string; organizationId: string; storeId: string; title: string; handle: string | null; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<EcommerceCollection> {
    return withDbErrorTranslation(() => tx.ecommerceCollection.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceCollection | null> {
    return withDbErrorTranslation(() => tx.ecommerceCollection.findUnique({ where: { id } }));
  },

  async findByHandle(storeId: string, handle: string, tx: TransactionClient | typeof db = db): Promise<EcommerceCollection | null> {
    return withDbErrorTranslation(() => tx.ecommerceCollection.findFirst({ where: { storeId, handle } }));
  },

  async listForStore(storeId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceCollection[]> {
    return withDbErrorTranslation(() => tx.ecommerceCollection.findMany({ where: { storeId }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  async listForStores(storeIds: string[], tx: TransactionClient | typeof db = db): Promise<EcommerceCollection[]> {
    if (storeIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.ecommerceCollection.findMany({ where: { storeId: { in: storeIds } } }));
  },

  async update(id: string, data: Partial<{ title: string; handle: string | null }>, tx: TransactionClient | typeof db = db): Promise<EcommerceCollection> {
    return withDbErrorTranslation(() => tx.ecommerceCollection.update({ where: { id }, data }));
  },

  async transition(id: string, from: EcommerceProductStatus, to: EcommerceProductStatus, tx: TransactionClient | typeof db = db): Promise<EcommerceCollection | null> {
    const result = await withDbErrorTranslation(() => tx.ecommerceCollection.updateMany({ where: { id, status: from }, data: { status: to } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ecommerceCollection.findUnique({ where: { id } }));
  },
};

/** Data access for `EcommerceCollectionProduct` (the collection↔product join). No DELETE grant per the standing append-only-evidence convention — a real "remove from collection" affordance would need its own explicit lifecycle decision; deliberately not built this pass (membership rows are additive-only). */
export const ecommerceCollectionProductRepository = {
  async create(input: { id: string; organizationId: string; collectionId: string; productId: string; sortOrder: number }, tx: TransactionClient | typeof db = db): Promise<EcommerceCollectionProduct> {
    return withDbErrorTranslation(() => tx.ecommerceCollectionProduct.create({ data: input }));
  },

  async exists(collectionId: string, productId: string, tx: TransactionClient | typeof db = db): Promise<boolean> {
    const row = await withDbErrorTranslation(() => tx.ecommerceCollectionProduct.findUnique({ where: { collectionId_productId: { collectionId, productId } } }));
    return row !== null;
  },

  async listForCollection(collectionId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceCollectionProduct[]> {
    return withDbErrorTranslation(() => tx.ecommerceCollectionProduct.findMany({ where: { collectionId }, orderBy: { sortOrder: "asc" }, take: 2000 }));
  },
};
