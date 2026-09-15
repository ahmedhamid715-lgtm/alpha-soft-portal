import "server-only";
import type { LocalRankObservation, LocalSeoDataSource, LocalRankStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface LocalRankObservationCreateInput {
  id: string;
  organizationId: string;
  keywordId: string;
  observedAt: Date;
  source: LocalSeoDataSource;
  rankStatus: LocalRankStatus;
  position: number | null;
  rankingProfileUrl: string | null;
  notes: string | null;
  importBatchId: string | null;
  createdByUserId: string;
}

/**
 * Data access for `LocalRankObservation` (Build 31 — Roadmap Module 25)
 * — pure append-only fact table. No UPDATE/DELETE grant at all (revoked
 * at the DB level, no RLS UPDATE policy either — see the migration).
 * Every method here is create/read only, mirroring
 * `seoRankObservationRepository` exactly, applying its own Codex
 * Performance Engineer LATERAL-join fix (finding P1) from the start.
 */
export const localRankObservationRepository = {
  async create(input: LocalRankObservationCreateInput, tx: TransactionClient | typeof db = db): Promise<LocalRankObservation> {
    return withDbErrorTranslation(() => tx.localRankObservation.create({ data: input }));
  },

  /** Batch insert for CSV import — `skipDuplicates` lets a re-uploaded file report "already existed" for colliding (keywordId, observedAt) rows instead of failing the whole batch. Returns the count actually inserted. */
  async createMany(inputs: LocalRankObservationCreateInput[], tx: TransactionClient | typeof db = db): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await withDbErrorTranslation(() => tx.localRankObservation.createMany({ data: inputs, skipDuplicates: true }));
    return result.count;
  },

  /** Most recent observations first — bounded, for a keyword's own history view. */
  async listForKeyword(keywordId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<LocalRankObservation[]> {
    return withDbErrorTranslation(() => tx.localRankObservation.findMany({ where: { keywordId }, orderBy: { observedAt: "desc" }, take: Math.min(limit, 200) }));
  },

  /**
   * The latest TWO real observations per keyword, for a whole location/
   * engagement at once — the batched, single-query source for both
   * "current rank" display and improving/declining KPI computation. Uses
   * the same `LATERAL` join shape `seoRankObservationRepository.
   * listLatestTwoForKeywords()`'s own Codex Performance Engineer finding
   * P1 established — applied correctly from the start here rather than
   * needing a later fix.
   */
  async listLatestTwoForKeywords(keywordIds: string[], tx: TransactionClient | typeof db = db): Promise<Array<{ keywordId: string; observedAt: Date; rankStatus: LocalRankStatus; position: number | null; rank: number }>> {
    if (keywordIds.length === 0) return [];
    return withDbErrorTranslation(() =>
      tx.$queryRaw<Array<{ keyword_id: string; observed_at: Date; rank_status: LocalRankStatus; position: number | null; rank: bigint }>>`
        SELECT requested.keyword_id, observation.observed_at, observation.rank_status, observation.position,
               ROW_NUMBER() OVER (PARTITION BY requested.keyword_id ORDER BY observation.observed_at DESC) AS rank
        FROM unnest(${keywordIds}::uuid[]) AS requested(keyword_id)
        CROSS JOIN LATERAL (
          SELECT observed_at, rank_status, position
          FROM local_rank_observations
          WHERE keyword_id = requested.keyword_id
          ORDER BY observed_at DESC
          LIMIT 2
        ) AS observation
      `.then((rows) => rows.map((r) => ({ keywordId: r.keyword_id, observedAt: r.observed_at, rankStatus: r.rank_status, position: r.position, rank: Number(r.rank) }))),
    );
  },

  /** Whether ANY observation exists yet for this exact (keywordId, observedAt) — pre-insert idempotency check used by both manual entry and CSV import's per-row validation. */
  async existsForKeywordAndDate(keywordId: string, observedAt: Date, tx: TransactionClient | typeof db = db): Promise<boolean> {
    const found = await withDbErrorTranslation(() => tx.localRankObservation.findUnique({ where: { keywordId_observedAt: { keywordId, observedAt } }, select: { id: true } }));
    return found !== null;
  },
};
