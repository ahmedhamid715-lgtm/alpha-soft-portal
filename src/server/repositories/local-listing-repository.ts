import "server-only";
import type { LocalListing, LocalSeoDataSource } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface LocalListingCreateInput {
  id: string;
  organizationId: string;
  locationId: string;
  sourceName: string;
  sourceUrl: string | null;
  observedBusinessName: string | null;
  observedAddressLine1: string | null;
  observedCity: string | null;
  observedPostalCode: string | null;
  observedPhone: string | null;
  observedWebsiteUrl: string | null;
  observedAt: Date;
  source: LocalSeoDataSource;
  importBatchId: string | null;
  createdByUserId: string;
}

export type LocalListingObservationUpdate = Pick<
  LocalListingCreateInput,
  "sourceUrl" | "observedBusinessName" | "observedAddressLine1" | "observedCity" | "observedPostalCode" | "observedPhone" | "observedWebsiteUrl" | "observedAt" | "source" | "importBatchId"
>;

/**
 * Data access for `LocalListing` (Build 31 — Roadmap Module 25) — a
 * "current known state" snapshot, DELIBERATELY MUTABLE (real UPDATE
 * grant). `upsertObservation()` is the primary write path: re-observing/
 * re-importing the same (locationId, sourceName) updates the existing
 * row in place rather than growing a history — see the model's own doc
 * comment in the migration for why. No DELETE grant.
 */
export const localListingRepository = {
  async findByLocationAndSource(locationId: string, sourceName: string, tx: TransactionClient | typeof db = db): Promise<LocalListing | null> {
    return withDbErrorTranslation(() => tx.localListing.findUnique({ where: { locationId_sourceName: { locationId, sourceName } } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalListing | null> {
    return withDbErrorTranslation(() => tx.localListing.findUnique({ where: { id } }));
  },

  async listForLocation(locationId: string, tx: TransactionClient | typeof db = db): Promise<LocalListing[]> {
    return withDbErrorTranslation(() => tx.localListing.findMany({ where: { locationId }, orderBy: { sourceName: "asc" }, take: 100 }));
  },

  /** Batched across several locations at once — never one query per location. */
  async listForLocations(locationIds: string[], tx: TransactionClient | typeof db = db): Promise<LocalListing[]> {
    if (locationIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.localListing.findMany({ where: { locationId: { in: locationIds } } }));
  },

  /** Insert-or-update-in-place on the (locationId, sourceName) unique key — the one real write path for recording a listing observation. */
  async upsertObservation(id: string, locationId: string, organizationId: string, sourceName: string, createdByUserId: string, data: LocalListingObservationUpdate, tx: TransactionClient | typeof db = db): Promise<LocalListing> {
    return withDbErrorTranslation(() =>
      tx.localListing.upsert({
        where: { locationId_sourceName: { locationId, sourceName } },
        create: { id, organizationId, locationId, sourceName, createdByUserId, ...data },
        update: data,
      }),
    );
  },
};
