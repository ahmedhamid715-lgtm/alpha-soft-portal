import "server-only";
import type { EcommerceStore, EcommerceStorePlatform, EcommerceStoreStatus, WebsiteConfigurationState } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface EcommerceStoreCreateInput {
  id: string;
  organizationId: string;
  engagementId: string;
  name: string;
  platform: EcommerceStorePlatform;
  externalStoreIdentifier: string | null;
  websiteSiteId: string | null;
  storeUrl: string | null;
  currency: string | null;
  createdByUserId: string;
}

export type EcommerceStoreUpdateInput = Partial<
  Pick<EcommerceStoreCreateInput, "name" | "platform" | "externalStoreIdentifier" | "websiteSiteId" | "storeUrl" | "currency"> & {
    launchTargetDate: Date | null;
    checkoutConfigured: WebsiteConfigurationState;
    paymentConfigured: WebsiteConfigurationState;
    paymentProviderLabel: string | null;
    shippingConfigured: WebsiteConfigurationState;
    taxConfigured: WebsiteConfigurationState;
    discountsConfigured: WebsiteConfigurationState;
    inventoryConfigured: WebsiteConfigurationState;
  }
>;

/** Data access for `EcommerceStore` (Build 33 — Roadmap Module 27). No DELETE grant — retired via `status = ARCHIVED`. Bounded to 100 per engagement (a realistic ceiling — most engagements deliver a single store). */
export const ecommerceStoreRepository = {
  async create(input: EcommerceStoreCreateInput, tx: TransactionClient | typeof db = db): Promise<EcommerceStore> {
    return withDbErrorTranslation(() => tx.ecommerceStore.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceStore | null> {
    return withDbErrorTranslation(() => tx.ecommerceStore.findUnique({ where: { id } }));
  },

  async findByExternalIdentifier(engagementId: string, externalStoreIdentifier: string, tx: TransactionClient | typeof db = db): Promise<EcommerceStore | null> {
    return withDbErrorTranslation(() => tx.ecommerceStore.findFirst({ where: { engagementId, externalStoreIdentifier } }));
  },

  async findByWebsiteSiteId(websiteSiteId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceStore | null> {
    return withDbErrorTranslation(() => tx.ecommerceStore.findFirst({ where: { websiteSiteId } }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceStore[]> {
    return withDbErrorTranslation(() => tx.ecommerceStore.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" }, take: 100 }));
  },

  /** Batched across several engagements at once — never one query per engagement. */
  async listForEngagements(engagementIds: string[], tx: TransactionClient | typeof db = db): Promise<EcommerceStore[]> {
    if (engagementIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.ecommerceStore.findMany({ where: { engagementId: { in: engagementIds } }, orderBy: { createdAt: "asc" } }));
  },

  async update(id: string, data: EcommerceStoreUpdateInput, tx: TransactionClient | typeof db = db): Promise<EcommerceStore> {
    return withDbErrorTranslation(() => tx.ecommerceStore.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status` currently NOT `ARCHIVED` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceStore | null> {
    const result = await withDbErrorTranslation(() => tx.ecommerceStore.updateMany({ where: { id, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ecommerceStore.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — restores to `IN_DEVELOPMENT` (never silently back to `LIVE`, which must be re-earned via a real launch record). */
  async reactivate(id: string, restoreStatus: EcommerceStoreStatus, tx: TransactionClient | typeof db = db): Promise<EcommerceStore | null> {
    const result = await withDbErrorTranslation(() => tx.ecommerceStore.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: restoreStatus } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ecommerceStore.findUnique({ where: { id } }));
  },

  /** The launch operation itself — CAS-guarded on `status` currently NOT `LIVE` AND NOT `ARCHIVED` (mirrors Website Dev's own WDEV-SEC-02 fix, applied from the start here rather than as a follow-up: an archived store must go through `reactivate()` first, never launch directly). */
  async recordLaunch(id: string, launchedAt: Date, tx: TransactionClient | typeof db = db): Promise<EcommerceStore | null> {
    const result = await withDbErrorTranslation(() => tx.ecommerceStore.updateMany({ where: { id, status: { notIn: ["LIVE", "ARCHIVED"] } }, data: { status: "LIVE", launchedAt } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ecommerceStore.findUnique({ where: { id } }));
  },
};
