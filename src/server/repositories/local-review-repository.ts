import "server-only";
import type { LocalReview, LocalSeoDataSource, LocalSeoReviewResponseStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";

export interface LocalReviewCreateInput {
  id: string;
  organizationId: string;
  locationId: string;
  externalReviewId: string | null;
  rating: number;
  reviewedAt: Date | null;
  reviewerDisplayName: string | null;
  text: string | null;
  source: LocalSeoDataSource;
  importBatchId: string | null;
  createdByUserId: string;
}

/**
 * Data access for `LocalReview` (Build 31 — Roadmap Module 25) —
 * individual review records, DELIBERATELY MUTABLE (real UPDATE grant)
 * for the response fields only (staff record their own draft/confirmed
 * response — never a fake "Reply on Google" action). No DELETE grant.
 * `externalReviewId` uniqueness (when known) is enforced by the DB's own
 * partial unique index (`local_reviews_external_id_key`); `createMany()`
 * uses `skipDuplicates` for the same reason
 * `seoRankObservationRepository.createMany()` does — a re-imported file
 * reports "already existed" instead of failing the whole batch.
 */
export const localReviewRepository = {
  async create(input: LocalReviewCreateInput, tx: TransactionClient | typeof db = db): Promise<LocalReview> {
    return withDbErrorTranslation(() => tx.localReview.create({ data: input }));
  },

  async createMany(inputs: LocalReviewCreateInput[], tx: TransactionClient | typeof db = db): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await withDbErrorTranslation(() => tx.localReview.createMany({ data: inputs, skipDuplicates: true }));
    return result.count;
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalReview | null> {
    return withDbErrorTranslation(() => tx.localReview.findUnique({ where: { id } }));
  },

  async findByExternalId(locationId: string, externalReviewId: string, tx: TransactionClient | typeof db = db): Promise<LocalReview | null> {
    return withDbErrorTranslation(() => tx.localReview.findFirst({ where: { locationId, externalReviewId } }));
  },

  async listForLocation(locationId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<LocalReview>> {
    const where = { locationId };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([tx.localReview.findMany({ where, orderBy: [{ reviewedAt: "desc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }), tx.localReview.count({ where })]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /**
   * Every review for a set of locations, unpaginated — for KPI
   * aggregation (count/average/new-in-period/response-coverage).
   * Bounded to 1000 (a realistic ceiling — beyond this a real
   * average-rating computation should move server-side/paginated).
   * Codex Performance Engineer finding (Build 31 performance review) —
   * the original version had no `orderBy`, so an over-cap customer's
   * count/average silently became an ARBITRARY subset rather than an
   * honest "most recent N" window. `reviewedAt DESC` (nulls last) makes
   * the cap an explicit recency window instead.
   */
  async listForLocations(locationIds: string[], tx: TransactionClient | typeof db = db): Promise<LocalReview[]> {
    if (locationIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.localReview.findMany({ where: { locationId: { in: locationIds } }, orderBy: [{ reviewedAt: "desc" }, { id: "asc" }], take: 1000 }));
  },

  /** Records a staff-confirmed draft/response — the only mutation ever applied to a review row. The service layer enforces the exact `responseStatus`/`respondedAt`/`respondedByUserId` consistency the DB's own CHECK constraint requires. */
  async recordResponse(
    id: string,
    data: { responseStatus: LocalSeoReviewResponseStatus; responseText: string | null; respondedAt: Date | null; respondedByUserId: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<LocalReview> {
    return withDbErrorTranslation(() => tx.localReview.update({ where: { id }, data }));
  },
};
