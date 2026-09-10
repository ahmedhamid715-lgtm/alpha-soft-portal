import type { TaskItem } from "./types";

/**
 * The ONE frozen, deterministic task ordering (Build 28 — Roadmap
 * Module 22): due date ascending (nulls last), then created date
 * ascending, then `sourceType`, then `sourceId` as the final tie-break
 * — every comparison total, so two runs of the same query against
 * unchanged data always return rows in the identical order (required
 * for stable pagination). Mirrored EXACTLY by the raw SQL
 * `ORDER BY due_at ASC NULLS LAST, created_at ASC, source_type ASC,
 * source_id ASC` in `global-task-query.ts` — this pure comparator exists
 * for in-memory sorting (small, single-source lists) and is unit-tested
 * as the executable specification of that SQL clause.
 */
export function compareTaskItems(a: TaskItem, b: TaskItem): number {
  const dueA = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
  const dueB = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;

  const createdA = a.createdAt.getTime();
  const createdB = b.createdAt.getTime();
  if (createdA !== createdB) return createdA - createdB;

  if (a.sourceType !== b.sourceType) return a.sourceType < b.sourceType ? -1 : 1;
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}
