/**
 * Launch-readiness formula (Build 32 — Roadmap Module 26). A pure
 * function over already-fetched real counts/facts — never computes its
 * own fabricated percentage, never treats a missing production
 * environment or primary domain as optional. `NOT_MEASURABLE` only when
 * no `WebsiteSite` exists at all (nothing to evaluate yet) — once a
 * site row exists, every input below is a real, present fact (even
 * "zero required pages" is real information, not missing data), so the
 * result is always a genuine `READY`/`NOT_READY` determination, never a
 * fabricated in-between value.
 *
 * Frozen inputs (see docs/architecture/website-development-os.md
 * "Launch readiness" for the full writeup):
 *   - production environment recorded — blocks unconditionally
 *   - primary domain recorded — blocks unconditionally
 *   - required WebsitePage rows reaching READY_FOR_LAUNCH/LIVE — blocks
 *     only if at least one required page exists
 *   - required ProjectQaCheck rows (on the linked Project, if any)
 *     reaching PASSED/WAIVED — blocks only if at least one required
 *     check exists (reused from Project QA directly — Website OS never
 *     builds a second QA engine)
 */
export type LaunchReadinessStatus = "READY" | "NOT_READY" | "NOT_MEASURABLE";

export interface LaunchReadinessInput {
  siteExists: boolean;
  hasPrimaryDomain: boolean;
  hasProductionEnvironment: boolean;
  requiredPageCount: number;
  completedRequiredPageCount: number;
  requiredQaCount: number;
  passedRequiredQaCount: number;
}

export interface LaunchReadinessResult {
  status: LaunchReadinessStatus;
  /** Empty when READY (or NOT_MEASURABLE) — every blocking reason, in a stable, deterministic order. */
  reasons: string[];
}

export function evaluateLaunchReadiness(input: LaunchReadinessInput): LaunchReadinessResult {
  if (!input.siteExists) {
    return { status: "NOT_MEASURABLE", reasons: ["No website site has been created for this engagement yet."] };
  }

  const reasons: string[] = [];
  if (!input.hasPrimaryDomain) reasons.push("No primary domain has been recorded for this site.");
  if (!input.hasProductionEnvironment) reasons.push("No production environment has been recorded for this site.");
  if (input.requiredPageCount > 0 && input.completedRequiredPageCount < input.requiredPageCount) {
    reasons.push(`${input.requiredPageCount - input.completedRequiredPageCount} of ${input.requiredPageCount} required page(s) are not yet ready for launch.`);
  }
  if (input.requiredQaCount > 0 && input.passedRequiredQaCount < input.requiredQaCount) {
    reasons.push(`${input.requiredQaCount - input.passedRequiredQaCount} of ${input.requiredQaCount} required QA check(s) have not passed.`);
  }

  return { status: reasons.length === 0 ? "READY" : "NOT_READY", reasons };
}
