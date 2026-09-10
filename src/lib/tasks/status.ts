import type { NormalizedTaskStatus, TaskSourceType } from "./types";

/**
 * Per-source status normalization (Build 28 — Roadmap Module 22). Each
 * source domain's own enum is preserved verbatim on `TaskItem.sourceStatus`
 * — this mapping exists ONLY for cross-source display/filtering, never
 * as a second interpretation of what a status "really means." A source
 * that has no CANCELLED concept (onboarding checklist/requirement items)
 * simply never produces that normalized value — never fabricated.
 */

const PROJECT_TASK_STATUS_MAP: Record<string, NormalizedTaskStatus> = {
  TODO: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  DONE: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const CRM_TASK_STATUS_MAP: Record<string, NormalizedTaskStatus> = {
  OPEN: "OPEN",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

/** Shared by both onboarding checklist items and requirements — identical enum shape (PENDING/IN_PROGRESS/COMPLETE), neither has a CANCELLED concept. */
const ONBOARDING_ITEM_STATUS_MAP: Record<string, NormalizedTaskStatus> = {
  PENDING: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETED",
};

const STANDALONE_TASK_STATUS_MAP: Record<string, NormalizedTaskStatus> = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const STATUS_MAP_BY_SOURCE: Record<TaskSourceType, Record<string, NormalizedTaskStatus>> = {
  PROJECT_TASK: PROJECT_TASK_STATUS_MAP,
  CRM_TASK: CRM_TASK_STATUS_MAP,
  ONBOARDING_CHECKLIST: ONBOARDING_ITEM_STATUS_MAP,
  ONBOARDING_REQUIREMENT: ONBOARDING_ITEM_STATUS_MAP,
  STANDALONE_TASK: STANDALONE_TASK_STATUS_MAP,
};

/** Throws on a genuinely unknown raw status for a source — that's a real data/schema-drift bug worth surfacing loudly, never silently coerced to a guess. */
export function normalizeTaskStatus(sourceType: TaskSourceType, rawStatus: string): NormalizedTaskStatus {
  const normalized = STATUS_MAP_BY_SOURCE[sourceType][rawStatus];
  if (!normalized) throw new Error(`Unknown ${sourceType} status "${rawStatus}" — no normalization mapping defined.`);
  return normalized;
}

export const TERMINAL_NORMALIZED_STATUSES: readonly NormalizedTaskStatus[] = ["COMPLETED", "CANCELLED"];

export function isTerminalStatus(status: NormalizedTaskStatus): boolean {
  return (TERMINAL_NORMALIZED_STATUSES as NormalizedTaskStatus[]).includes(status);
}
