/**
 * Launch-readiness formula (Build 33 — Roadmap Module 27). A pure
 * function over already-fetched real counts/facts — mirrors Website
 * Dev's own `evaluateLaunchReadiness()` (Build 32) shape exactly, but a
 * genuinely separate formula for a separate domain, never shared.
 * `NOT_MEASURABLE` only when no `EcommerceStore` exists at all — once a
 * store row exists, every input below is a real, present fact, so the
 * result is always a genuine `READY`/`NOT_READY` determination, never a
 * fabricated in-between value.
 *
 * Frozen inputs (see docs/architecture/ecommerce-development-os.md
 * "Launch readiness" for the full writeup):
 *   - checkout configured — blocks unconditionally (a store cannot
 *     transact without one)
 *   - payment configured — blocks unconditionally (same reasoning)
 *   - required `EcommerceProduct` rows reaching READY_FOR_LAUNCH/LIVE —
 *     blocks only if at least one required product exists
 *   - required `ProjectQaCheck` rows (on the linked Project, if any)
 *     reaching PASSED/WAIVED — blocks only if at least one required
 *     check exists (reused from Project QA directly — E-Commerce OS
 *     never builds a second QA engine)
 *   - the linked `WebsiteSite`'s own readiness (if the store has one) —
 *     NEVER re-derived here; the caller passes Website Development's
 *     own already-computed `READY`/`NOT_READY` verdict straight through
 *     ("Website not launch-ready → commerce store cannot be fully
 *     launch-ready" — this module must not duplicate that formula).
 */
export type EcommerceReadinessStatus = "READY" | "NOT_READY" | "NOT_MEASURABLE";

export interface EcommerceReadinessInput {
  storeExists: boolean;
  checkoutConfigured: boolean;
  paymentConfigured: boolean;
  requiredProductCount: number;
  completedRequiredProductCount: number;
  requiredQaCount: number;
  passedRequiredQaCount: number;
  /** The linked `WebsiteSite`'s own readiness status, reused verbatim — `null` when no `WebsiteSite` is linked (not itself a blocker; a headless/API-only store has no storefront to be ready or not). */
  linkedWebsiteReadiness: "READY" | "NOT_READY" | null;
}

export interface EcommerceReadinessResult {
  status: EcommerceReadinessStatus;
  /** Empty when READY (or NOT_MEASURABLE) — every blocking reason, in a stable, deterministic order. */
  reasons: string[];
}

export function evaluateEcommerceReadiness(input: EcommerceReadinessInput): EcommerceReadinessResult {
  if (!input.storeExists) {
    return { status: "NOT_MEASURABLE", reasons: ["No store has been created for this engagement yet."] };
  }

  const reasons: string[] = [];
  if (!input.checkoutConfigured) reasons.push("Checkout has not been confirmed as configured for this store.");
  if (!input.paymentConfigured) reasons.push("Payment has not been confirmed as configured for this store.");
  if (input.requiredProductCount > 0 && input.completedRequiredProductCount < input.requiredProductCount) {
    reasons.push(`${input.requiredProductCount - input.completedRequiredProductCount} of ${input.requiredProductCount} required product(s) are not yet ready for launch.`);
  }
  if (input.requiredQaCount > 0 && input.passedRequiredQaCount < input.requiredQaCount) {
    reasons.push(`${input.requiredQaCount - input.passedRequiredQaCount} of ${input.requiredQaCount} required QA check(s) have not passed.`);
  }
  if (input.linkedWebsiteReadiness === "NOT_READY") {
    reasons.push("The linked website storefront is not yet launch-ready.");
  }

  return { status: reasons.length === 0 ? "READY" : "NOT_READY", reasons };
}
