/**
 * Go-live readiness formula (Build 34 — Roadmap Module 28). A pure
 * function over already-fetched real counts/facts — mirrors Website
 * Dev's/E-Commerce's own `evaluate*Readiness()` shape, but a genuinely
 * separate formula for a separate domain, never shared. `NOT_MEASURABLE`
 * only when no `GhlWorkspace` exists at all; once a workspace row
 * exists, every input below is a real, present fact, so the result is
 * always a genuine `READY`/`NOT_READY` determination, never a
 * fabricated in-between value.
 *
 * Frozen inputs (see docs/architecture/ghl-automation-os.md "Readiness"
 * for the full writeup):
 *   - required `GhlAsset` rows reaching READY/LIVE — blocks only if at
 *     least one required asset exists
 *   - required `GhlAsset` rows in QA_FAILED — blocks unconditionally
 *     whenever at least one exists (a known-failing required asset is a
 *     stronger signal than "not yet ready" and is always reported,
 *     never silently folded into the not-ready-count above)
 *   - required `GhlIntegrationRequirement` rows reaching CONFIRMED —
 *     blocks only if at least one required requirement exists
 *   - required `ProjectQaCheck` rows (on the linked Project, if any)
 *     reaching PASSED/WAIVED — blocks only if at least one required
 *     check exists (reused from Project QA directly — GHL Automation OS
 *     never builds a second QA engine)
 *
 * Deliberately no cross-domain readiness pass-through (unlike
 * E-Commerce's own linked-WebsiteSite input) — a GHL workspace has no
 * structural link to any other specialist domain's own delivery
 * surface, so this formula stays fully self-contained to this domain +
 * Project QA.
 */
export type GhlReadinessStatus = "READY" | "NOT_READY" | "NOT_MEASURABLE";

export interface GhlReadinessInput {
  workspaceExists: boolean;
  requiredAssetCount: number;
  completedRequiredAssetCount: number;
  qaFailedRequiredAssetCount: number;
  requiredIntegrationCount: number;
  confirmedRequiredIntegrationCount: number;
  requiredQaCount: number;
  passedRequiredQaCount: number;
}

export interface GhlReadinessResult {
  status: GhlReadinessStatus;
  /** Empty when READY (or NOT_MEASURABLE) — every blocking reason, in a stable, deterministic order. */
  reasons: string[];
}

export function evaluateGhlReadiness(input: GhlReadinessInput): GhlReadinessResult {
  if (!input.workspaceExists) {
    return { status: "NOT_MEASURABLE", reasons: ["No GHL workspace has been recorded for this engagement yet."] };
  }

  const reasons: string[] = [];
  if (input.qaFailedRequiredAssetCount > 0) {
    reasons.push(`${input.qaFailedRequiredAssetCount} required asset(s) are failing QA.`);
  }
  if (input.requiredAssetCount > 0 && input.completedRequiredAssetCount < input.requiredAssetCount) {
    reasons.push(`${input.requiredAssetCount - input.completedRequiredAssetCount} of ${input.requiredAssetCount} required asset(s) are not yet ready.`);
  }
  if (input.requiredIntegrationCount > 0 && input.confirmedRequiredIntegrationCount < input.requiredIntegrationCount) {
    reasons.push(`${input.requiredIntegrationCount - input.confirmedRequiredIntegrationCount} of ${input.requiredIntegrationCount} required integration(s) are not yet confirmed.`);
  }
  if (input.requiredQaCount > 0 && input.passedRequiredQaCount < input.requiredQaCount) {
    reasons.push(`${input.requiredQaCount - input.passedRequiredQaCount} of ${input.requiredQaCount} required QA check(s) have not passed.`);
  }

  return { status: reasons.length === 0 ? "READY" : "NOT_READY", reasons };
}
