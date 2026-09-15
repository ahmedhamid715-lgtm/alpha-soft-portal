import "server-only";
import type { GbpProfile, LocalSeoDataSource, LocalSeoVerificationState } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface GbpProfileCreateInput {
  id: string;
  organizationId: string;
  locationId: string;
  externalProfileId: string | null;
  profileUrl: string | null;
  primaryCategory: string | null;
  secondaryCategories: string[];
  verificationState: LocalSeoVerificationState;
  observedStatus: string | null;
  lastObservedAt: Date | null;
  source: LocalSeoDataSource;
  createdByUserId: string;
}

export type GbpProfileUpdateInput = Partial<
  Pick<GbpProfileCreateInput, "externalProfileId" | "profileUrl" | "primaryCategory" | "secondaryCategories" | "verificationState" | "observedStatus" | "lastObservedAt" | "source">
>;

/**
 * Data access for `GbpProfile` (Build 31 — Roadmap Module 25) — the
 * Google Business Profile identity for a location, separate from the
 * location's own operational data. Exactly one per location (`locationId`
 * UNIQUE) — `upsert()` below is the primary write path (staff record or
 * re-record what was observed; there is no create-vs-update distinction
 * meaningful to the caller). No DELETE grant.
 */
export const gbpProfileRepository = {
  async findByLocationId(locationId: string, tx: TransactionClient | typeof db = db): Promise<GbpProfile | null> {
    return withDbErrorTranslation(() => tx.gbpProfile.findUnique({ where: { locationId } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<GbpProfile | null> {
    return withDbErrorTranslation(() => tx.gbpProfile.findUnique({ where: { id } }));
  },

  /** Batched across several locations at once — never one query per location. */
  async listForLocations(locationIds: string[], tx: TransactionClient | typeof db = db): Promise<GbpProfile[]> {
    if (locationIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.gbpProfile.findMany({ where: { locationId: { in: locationIds } } }));
  },

  async create(input: GbpProfileCreateInput, tx: TransactionClient | typeof db = db): Promise<GbpProfile> {
    return withDbErrorTranslation(() => tx.gbpProfile.create({ data: input }));
  },

  async update(id: string, data: GbpProfileUpdateInput, tx: TransactionClient | typeof db = db): Promise<GbpProfile> {
    return withDbErrorTranslation(() => tx.gbpProfile.update({ where: { id }, data }));
  },
};
