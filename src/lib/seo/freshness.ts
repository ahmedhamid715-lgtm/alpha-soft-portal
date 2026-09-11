/**
 * Data-freshness classification (Build 30 — Roadmap Module 24). Pure
 * display-layer classification over a real "most recent observation/
 * audit" timestamp the caller already fetched — never stored, never
 * used to gate anything, purely so staff/customers can tell current
 * data from stale data at a glance instead of a bare timestamp they'd
 * have to mentally do the math on. Matches the master prompt's own
 * explicit "distinguish current / stale / unavailable / never
 * collected / failed collection" requirement.
 */
export type SeoFreshness = "FRESH" | "AGING" | "STALE" | "NEVER_COLLECTED";

const AGING_AFTER_DAYS = 7;
const STALE_AFTER_DAYS = 30;

export function classifyFreshness(lastObservedAt: Date | null, now: Date = new Date()): SeoFreshness {
  if (!lastObservedAt) return "NEVER_COLLECTED";
  const daysSince = (now.getTime() - lastObservedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSince <= AGING_AFTER_DAYS) return "FRESH";
  if (daysSince <= STALE_AFTER_DAYS) return "AGING";
  return "STALE";
}

export const SEO_FRESHNESS_LABELS: Record<SeoFreshness, string> = {
  FRESH: "Fresh",
  AGING: "Aging",
  STALE: "Stale",
  NEVER_COLLECTED: "Never collected",
};
