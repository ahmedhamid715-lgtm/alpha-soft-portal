/**
 * Hybrid-search ranking (Module 18, spec §7). Reciprocal Rank Fusion
 * (RRF) — a deterministic, well-established algorithm (Cormack, Clarke
 * & Buettcher, 2009) for combining multiple independently-RANKED lists
 * (here: vector-similarity order and full-text-search order) into one
 * final ranking, WITHOUT needing the two lists' raw scores to be on a
 * comparable scale (cosine distance and a `ts_rank` score have no
 * natural common unit — RRF sidesteps that entirely by using each
 * item's RANK POSITION, not its raw score).
 *
 * Deliberately NOT an LLM-based re-ranker — spec §32's own "do not
 * overbuild" boundary; a deterministic, explainable ranking function is
 * the right foundation-module choice, not a second AI call per
 * retrieval.
 */

/** The standard RRF constant from the original paper — dampens the influence of a very high rank in any ONE list so no single list can dominate the fused ranking by itself. Not a tunable exposed anywhere; changing it is a deliberate algorithm change, not a runtime config. */
const RRF_K = 60;

export interface RankedListItem {
  id: string;
}

export interface FusedResult {
  id: string;
  score: number;
  /** Which input lists this id actually appeared in — real provenance for "why did this get ranked here," not just a bare number. */
  matchedIn: number;
}

/**
 * `rankedLists` — each an array already sorted best-first (rank 1 =
 * index 0). Returns every id that appeared in at least one list, sorted
 * by fused score descending (ties broken by id for determinism — never
 * left to an unstable sort's own arbitrary tie behavior).
 */
export function reciprocalRankFusion(rankedLists: RankedListItem[][]): FusedResult[] {
  const scores = new Map<string, { score: number; matchedIn: number }>();

  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const rank = index + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += contribution;
        existing.matchedIn += 1;
      } else {
        scores.set(item.id, { score: contribution, matchedIn: 1 });
      }
    });
  }

  return Array.from(scores.entries())
    .map(([id, { score, matchedIn }]) => ({ id, score, matchedIn }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}
