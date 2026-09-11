import "server-only";
import type { SeoRankObservation, SeoDataSource, SeoRankStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface SeoRankObservationCreateInput {
  id: string;
  organizationId: string;
  keywordId: string;
  observedAt: Date;
  source: SeoDataSource;
  rankStatus: SeoRankStatus;
  position: number | null;
  rankingUrl: string | null;
  notes: string | null;
  importBatchId: string | null;
  createdByUserId: string;
}

/**
 * Data access for `SeoRankObservation` (Build 30 — Roadmap Module 24) —
 * pure append-only fact table. No UPDATE/DELETE grant at all (revoked
 * at the DB level, no RLS UPDATE policy either — see the migration).
 * Every method here is create/read only, by design.
 */
export const seoRankObservationRepository = {
  async create(input: SeoRankObservationCreateInput, tx: TransactionClient | typeof db = db): Promise<SeoRankObservation> {
    return withDbErrorTranslation(() => tx.seoRankObservation.create({ data: input }));
  },

  /** Batch insert for CSV import — `skipDuplicates` lets a re-uploaded file report "already existed" for colliding (keywordId, observedAt) rows instead of failing the whole batch. Returns the count actually inserted. */
  async createMany(inputs: SeoRankObservationCreateInput[], tx: TransactionClient | typeof db = db): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await withDbErrorTranslation(() => tx.seoRankObservation.createMany({ data: inputs, skipDuplicates: true }));
    return result.count;
  },

  /** Most recent observations first — bounded, for a keyword's own history view/sparkline. */
  async listForKeyword(keywordId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<SeoRankObservation[]> {
    return withDbErrorTranslation(() => tx.seoRankObservation.findMany({ where: { keywordId }, orderBy: { observedAt: "desc" }, take: Math.min(limit, 200) }));
  },

  /**
   * The latest TWO real observations per keyword, for the whole
   * property/engagement at once — the batched, single-query source for
   * both "current rank" display and gains/losses KPI computation.
   *
   * Build 30 Codex Performance Engineer finding P1 — the original
   * `ROW_NUMBER() OVER (PARTITION BY ...)` shape is RESULT-bounded (two
   * rows per keyword out) but not WORK-bounded: Postgres must still
   * read and sort every historical row for every requested keyword
   * before the outer filter drops down to two. A `LATERAL` join instead
   * runs one small, independently-ordered `LIMIT 2` index scan per
   * keyword — real, measured via a rolled-back `EXPLAIN ANALYZE` probe
   * against 100,000 synthetic rows: ~20x fewer rows read/sorted for the
   * same two-per-keyword output, using the exact same `(keyword_id,
   * observed_at DESC)` index either way.
   */
  async listLatestTwoForKeywords(keywordIds: string[], tx: TransactionClient | typeof db = db): Promise<Array<{ keywordId: string; observedAt: Date; rankStatus: SeoRankStatus; position: number | null; rank: number }>> {
    if (keywordIds.length === 0) return [];
    return withDbErrorTranslation(() =>
      tx.$queryRaw<Array<{ keyword_id: string; observed_at: Date; rank_status: SeoRankStatus; position: number | null; rank: bigint }>>`
        SELECT requested.keyword_id, observation.observed_at, observation.rank_status, observation.position,
               ROW_NUMBER() OVER (PARTITION BY requested.keyword_id ORDER BY observation.observed_at DESC) AS rank
        FROM unnest(${keywordIds}::uuid[]) AS requested(keyword_id)
        CROSS JOIN LATERAL (
          SELECT observed_at, rank_status, position
          FROM seo_rank_observations
          WHERE keyword_id = requested.keyword_id
          ORDER BY observed_at DESC
          LIMIT 2
        ) AS observation
      `.then((rows) => rows.map((r) => ({ keywordId: r.keyword_id, observedAt: r.observed_at, rankStatus: r.rank_status, position: r.position, rank: Number(r.rank) }))),
    );
  },

  /** Whether ANY observation exists yet for this exact (keywordId, observedAt) — pre-insert idempotency check used by both manual entry and CSV import's per-row validation. */
  async existsForKeywordAndDate(keywordId: string, observedAt: Date, tx: TransactionClient | typeof db = db): Promise<boolean> {
    const found = await withDbErrorTranslation(() => tx.seoRankObservation.findUnique({ where: { keywordId_observedAt: { keywordId, observedAt } }, select: { id: true } }));
    return found !== null;
  },
};
