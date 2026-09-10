import { isTerminalStatus } from "./status";
import type { NormalizedTaskStatus } from "./types";

/**
 * Due-date/overdue semantics (Build 28 — Roadmap Module 22) — frozen,
 * UTC-calendar-day granularity. This deliberately matches this
 * platform's own already-established "UTC is the canonical day
 * boundary" convention (see e.g. Customer 360's own `fmtDate()`,
 * `formatInTimeZone(date, "UTC", ...)`) rather than either a raw
 * sub-day timestamp comparison or the signed-in user's own local
 * timezone — a single frozen, server-authoritative boundary, never
 * "server UTC day" mixed with "user-local day."
 *
 * A day-granularity `isOverdue` (rather than a bare `dueAt < now`
 * instant comparison) is a deliberate choice so a task due "today" is
 * never simultaneously reported as both `isOverdue` and grouped into
 * the "Due today" bucket — the two would otherwise contradict each
 * other the moment any part of today has elapsed. Both the per-row
 * `isOverdue` flag AND the "Due today"/"Upcoming"/"Overdue" filter
 * buckets use this SAME formula, so they can never disagree.
 */

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type DueWindow = "OVERDUE" | "DUE_TODAY" | "UPCOMING" | "NO_DUE_DATE";

/** Completed/cancelled work is NEVER overdue, regardless of how far in the past its due date was — a source that mistakenly reports a completed task as "overdue" is a data-honesty bug this function structurally cannot produce. */
export function isOverdue(dueAt: Date | null, status: NormalizedTaskStatus, now: Date = new Date()): boolean {
  if (dueAt === null || isTerminalStatus(status)) return false;
  return utcDayKey(dueAt) < utcDayKey(now);
}

/** `null` for a terminal (COMPLETED/CANCELLED) task — due-window grouping only applies to open work; a completed task belongs in its own "Completed" filter, not any due-window bucket. */
export function classifyDueWindow(dueAt: Date | null, status: NormalizedTaskStatus, now: Date = new Date()): DueWindow | null {
  if (isTerminalStatus(status)) return null;
  if (dueAt === null) return "NO_DUE_DATE";
  const dueDay = utcDayKey(dueAt);
  const today = utcDayKey(now);
  if (dueDay < today) return "OVERDUE";
  if (dueDay === today) return "DUE_TODAY";
  return "UPCOMING";
}
