import "server-only";
import type { LocalSeoLocation, LocalSeoDataSource } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface LocalSeoLocationCreateInput {
  id: string;
  organizationId: string;
  engagementId: string;
  businessName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  websiteUrl: string | null;
  normalizedWebsiteOrigin: string | null;
  serviceAreaBusiness: boolean;
  source: LocalSeoDataSource;
  createdByUserId: string;
}

export type LocalSeoLocationUpdateInput = Partial<
  Pick<
    LocalSeoLocationCreateInput,
    "businessName" | "addressLine1" | "addressLine2" | "city" | "region" | "postalCode" | "country" | "phone" | "websiteUrl" | "normalizedWebsiteOrigin" | "serviceAreaBusiness"
  >
>;

/**
 * Data access for `LocalSeoLocation` (Build 31 — Roadmap Module 25) — the
 * tracked business location. No DELETE grant — retired via `archive()`.
 * Bounded to 200 per engagement (a realistic ceiling for even a large
 * multi-location Local SEO engagement).
 */
export const localSeoLocationRepository = {
  async create(input: LocalSeoLocationCreateInput, tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation> {
    return withDbErrorTranslation(() => tx.localSeoLocation.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation | null> {
    return withDbErrorTranslation(() => tx.localSeoLocation.findUnique({ where: { id } }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation[]> {
    return withDbErrorTranslation(() => tx.localSeoLocation.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" }, take: 200 }));
  },

  /** Batched across several engagements at once — never one query per engagement. */
  async listForEngagements(engagementIds: string[], tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation[]> {
    if (engagementIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.localSeoLocation.findMany({ where: { engagementId: { in: engagementIds } }, orderBy: { createdAt: "asc" } }));
  },

  async update(id: string, data: LocalSeoLocationUpdateInput, tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation> {
    return withDbErrorTranslation(() => tx.localSeoLocation.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status = ACTIVE` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation | null> {
    const result = await withDbErrorTranslation(() => tx.localSeoLocation.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoLocation.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — a lost race (already active) returns `null`. */
  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoLocation | null> {
    const result = await withDbErrorTranslation(() => tx.localSeoLocation.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoLocation.findUnique({ where: { id } }));
  },
};
