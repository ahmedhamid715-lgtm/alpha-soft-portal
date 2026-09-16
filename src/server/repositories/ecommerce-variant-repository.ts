import "server-only";
import type { EcommerceVariant, EcommerceProductStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface EcommerceVariantCreateInput {
  id: string;
  organizationId: string;
  productId: string;
  storeId: string;
  title: string;
  externalVariantId: string | null;
  sku: string | null;
  option1Name: string | null;
  option1Value: string | null;
  option2Name: string | null;
  option2Value: string | null;
  option3Name: string | null;
  option3Value: string | null;
  priceMinorUnits: number | null;
  compareAtPriceMinorUnits: number | null;
  createdByUserId: string;
}

/** Data access for `EcommerceVariant` (Build 33 — Roadmap Module 27). No DELETE grant — retired via `status = ARCHIVED`. `storeId` is denormalized from the parent product specifically so SKU uniqueness can be a real per-store DB constraint (kept consistent by a DB trigger — see the migration). */
export const ecommerceVariantRepository = {
  async create(input: EcommerceVariantCreateInput, tx: TransactionClient | typeof db = db): Promise<EcommerceVariant> {
    return withDbErrorTranslation(() => tx.ecommerceVariant.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceVariant | null> {
    return withDbErrorTranslation(() => tx.ecommerceVariant.findUnique({ where: { id } }));
  },

  async findBySku(storeId: string, sku: string, tx: TransactionClient | typeof db = db): Promise<EcommerceVariant | null> {
    return withDbErrorTranslation(() => tx.ecommerceVariant.findFirst({ where: { storeId, sku } }));
  },

  async listForProduct(productId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceVariant[]> {
    return withDbErrorTranslation(() => tx.ecommerceVariant.findMany({ where: { productId }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  /** Batched across several products at once — never one query per product. Bounded to 2000 (a generous realistic ceiling for a single overview read). */
  async listForProducts(productIds: string[], tx: TransactionClient | typeof db = db): Promise<EcommerceVariant[]> {
    if (productIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.ecommerceVariant.findMany({ where: { productId: { in: productIds } }, take: 2000 }));
  },

  async update(
    id: string,
    data: Partial<{
      title: string;
      sku: string | null;
      option1Name: string | null;
      option1Value: string | null;
      option2Name: string | null;
      option2Value: string | null;
      option3Name: string | null;
      option3Value: string | null;
      priceMinorUnits: number | null;
      compareAtPriceMinorUnits: number | null;
    }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<EcommerceVariant> {
    return withDbErrorTranslation(() => tx.ecommerceVariant.update({ where: { id }, data }));
  },

  /** CAS-guarded on the exact `from` status. */
  async transition(id: string, from: EcommerceProductStatus, to: EcommerceProductStatus, tx: TransactionClient | typeof db = db): Promise<EcommerceVariant | null> {
    const result = await withDbErrorTranslation(() => tx.ecommerceVariant.updateMany({ where: { id, status: from }, data: { status: to } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ecommerceVariant.findUnique({ where: { id } }));
  },
};
