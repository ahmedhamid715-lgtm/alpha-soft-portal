import type { NormalizedTaskStatus, TaskSourceType } from "./types";

/**
 * The reverse of `normalizeTaskStatus()` — given a set of normalized
 * statuses a caller filtered by, return the RAW status values that
 * actually exist for one source. A source with no matching raw status
 * for any requested normalized value (e.g. filtering by CANCELLED
 * against an onboarding source, which has no cancellation concept)
 * correctly returns an empty array — the caller (the global task query)
 * treats an empty array as "this branch contributes zero rows for this
 * filter," never as "no filter — return everything."
 */
const RAW_STATUSES_BY_SOURCE: Record<TaskSourceType, Record<NormalizedTaskStatus, string[]>> = {
  PROJECT_TASK: { OPEN: ["TODO"], IN_PROGRESS: ["IN_PROGRESS"], BLOCKED: ["BLOCKED"], COMPLETED: ["DONE"], CANCELLED: ["CANCELLED"] },
  CRM_TASK: { OPEN: ["OPEN"], IN_PROGRESS: [], BLOCKED: [], COMPLETED: ["COMPLETED"], CANCELLED: ["CANCELLED"] },
  ONBOARDING_CHECKLIST: { OPEN: ["PENDING"], IN_PROGRESS: ["IN_PROGRESS"], BLOCKED: [], COMPLETED: ["COMPLETE"], CANCELLED: [] },
  ONBOARDING_REQUIREMENT: { OPEN: ["PENDING"], IN_PROGRESS: ["IN_PROGRESS"], BLOCKED: [], COMPLETED: ["COMPLETE"], CANCELLED: [] },
  STANDALONE_TASK: { OPEN: ["OPEN"], IN_PROGRESS: ["IN_PROGRESS"], BLOCKED: [], COMPLETED: ["COMPLETED"], CANCELLED: ["CANCELLED"] },
};

export function denormalizeStatusesForSource(sourceType: TaskSourceType, normalizedStatuses: NormalizedTaskStatus[]): string[] {
  const map = RAW_STATUSES_BY_SOURCE[sourceType];
  return normalizedStatuses.flatMap((status) => map[status]);
}

/** Every raw status value a source can ever have — used when no status filter is applied, so a branch still only ever returns values its own enum actually has. */
export function allRawStatusesForSource(sourceType: TaskSourceType): string[] {
  return Object.values(RAW_STATUSES_BY_SOURCE[sourceType]).flat();
}
