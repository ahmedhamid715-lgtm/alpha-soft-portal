/**
 * MRR movement classification (spec §4) — pure, over already-fetched
 * authoritative records. There is NO historical MRR snapshot table in
 * this platform (deliberately — see database-rules discussion in
 * `revenue-metrics.md`: a snapshot table would be a second source of
 * truth for a value that's already fully derivable). This module
 * defines the ONE supported measurement method, built entirely from
 * real, immutable, already-existing records:
 *
 *   - NEW / REACTIVATION — `Subscription.createdAt` falling inside the
 *     period. Distinguished by whether the organization has an EARLIER
 *     subscription of its own with a `canceledAt` set before this one's
 *     `createdAt` (REACTIVATION) or not (NEW). Both are real, queryable
 *     facts — never inferred from a missing snapshot.
 *   - CHURN — `Subscription.canceledAt` falling inside the period,
 *     status now `CANCELED`. The MRR "lost" is read from the
 *     subscription's OWN `SubscriptionItem` rows as they stand today
 *     (items are never deleted on cancellation — spec §28's "never
 *     delete subscription history" — so they still reflect exactly what
 *     the subscription was billing immediately before it ended).
 *   - EXPANSION / CONTRACTION — a `billing.plan.changed` audit event
 *     (Module 14's own `changeSubscriptionPlan()`) falling inside the
 *     period. `previousState.planPriceId` / `newState.planPriceId` are
 *     real values Module 14 already records on every plan change; this
 *     module compares the two `PlanPrice`s' own monthly-equivalent
 *     value (the SAME `monthlyEquivalent()` the MRR engine uses) to
 *     classify direction and compute the exact delta.
 *
 * **Documented limitation** (spec §4's own explicit permission to state
 * this rather than fabricate): a plan change made by any means OTHER
 * than `changeSubscriptionPlan()` (e.g. a subscription edited directly
 * in the Stripe dashboard, bypassing Alpha OS entirely) produces no
 * `billing.plan.changed` audit event and is therefore invisible to
 * movement classification — the resulting webhook still updates
 * `SubscriptionItem` correctly (current MRR is still accurate), just
 * without a movement explanation for HOW it changed. A quantity change
 * bundled into the SAME plan-change event is also not separately
 * distinguished from the price change — the audit event's own
 * `previousState`/`newState` capture `planPriceId` only, not quantity;
 * this module uses the subscription item's CURRENT quantity for both
 * sides of the comparison, which is exact for a pure price change and
 * an approximation if quantity also changed in the same request.
 */

export type MrrMovementType = "NEW" | "EXPANSION" | "CONTRACTION" | "CHURN" | "REACTIVATION";

export interface MrrMovement {
  organizationId: string;
  subscriptionId: string;
  type: MrrMovementType;
  /** Minor units. `null` when there is no meaningful "before" (NEW, REACTIVATION). */
  previousMrr: number | null;
  /** Minor units. `null` for CHURN (the subscription no longer contributes anything). */
  currentMrr: number | null;
  /** Minor units, signed — positive for NEW/EXPANSION/REACTIVATION, negative for CONTRACTION/CHURN. */
  delta: number;
  currency: string;
  effectiveDate: Date;
}

export interface SubscriptionLifecycleFact {
  subscriptionId: string;
  organizationId: string;
  createdAt: Date;
  canceledAt: Date | null;
  status: string;
  currency: string;
  /** This subscription's CURRENT monthly-equivalent MRR contribution (already computed by the MRR engine from its current items), used as: the "current" value for a NEW/REACTIVATION event, and the "lost" value for a CHURN event (items are frozen at cancellation, so "current" and "value just before churn" are the same number). */
  currentMonthlyEquivalent: number;
}

/** Classifies NEW and REACTIVATION movements from subscription lifecycle facts. `allSubscriptionsForOrg` must include EVERY subscription (any status) the organization has ever had, sorted or not — used only to determine "did this org have an earlier, since-canceled subscription." */
export function classifyNewAndReactivation(
  subscriptions: SubscriptionLifecycleFact[],
  periodStart: Date,
  periodEnd: Date,
  allSubscriptionsByOrg: Map<string, SubscriptionLifecycleFact[]>,
): MrrMovement[] {
  const movements: MrrMovement[] = [];
  for (const subscription of subscriptions) {
    const createdAtMs = subscription.createdAt.getTime();
    if (createdAtMs < periodStart.getTime() || createdAtMs >= periodEnd.getTime()) continue;

    const orgSubscriptions = allSubscriptionsByOrg.get(subscription.organizationId) ?? [];
    const hasEarlierChurnedSubscription = orgSubscriptions.some(
      (other) => other.subscriptionId !== subscription.subscriptionId && other.canceledAt !== null && other.canceledAt.getTime() < createdAtMs,
    );

    movements.push({
      organizationId: subscription.organizationId,
      subscriptionId: subscription.subscriptionId,
      type: hasEarlierChurnedSubscription ? "REACTIVATION" : "NEW",
      previousMrr: null,
      currentMrr: subscription.currentMonthlyEquivalent,
      delta: subscription.currentMonthlyEquivalent,
      currency: subscription.currency,
      effectiveDate: subscription.createdAt,
    });
  }
  return movements;
}

/** Classifies CHURN movements. */
export function classifyChurn(subscriptions: SubscriptionLifecycleFact[], periodStart: Date, periodEnd: Date): MrrMovement[] {
  const movements: MrrMovement[] = [];
  for (const subscription of subscriptions) {
    if (subscription.status !== "CANCELED" || subscription.canceledAt === null) continue;
    const canceledAtMs = subscription.canceledAt.getTime();
    if (canceledAtMs < periodStart.getTime() || canceledAtMs >= periodEnd.getTime()) continue;

    movements.push({
      organizationId: subscription.organizationId,
      subscriptionId: subscription.subscriptionId,
      type: "CHURN",
      previousMrr: subscription.currentMonthlyEquivalent,
      currentMrr: null,
      delta: -subscription.currentMonthlyEquivalent,
      currency: subscription.currency,
      effectiveDate: subscription.canceledAt,
    });
  }
  return movements;
}

export interface PlanChangeFact {
  organizationId: string;
  subscriptionId: string;
  occurredAt: Date;
  previousMonthlyEquivalent: number;
  newMonthlyEquivalent: number;
  currency: string;
}

/** Classifies EXPANSION/CONTRACTION from real `billing.plan.changed` audit facts (already resolved to monthly-equivalent values by the caller — this function does no PlanPrice lookups of its own, staying a pure classifier). A change where the two values are EQUAL (a lateral move — e.g. a nickname-only price swap) produces no movement at all, never a fabricated zero-delta row. */
export function classifyExpansionAndContraction(changes: PlanChangeFact[]): MrrMovement[] {
  const movements: MrrMovement[] = [];
  for (const change of changes) {
    const delta = change.newMonthlyEquivalent - change.previousMonthlyEquivalent;
    if (delta === 0) continue;
    movements.push({
      organizationId: change.organizationId,
      subscriptionId: change.subscriptionId,
      type: delta > 0 ? "EXPANSION" : "CONTRACTION",
      previousMrr: change.previousMonthlyEquivalent,
      currentMrr: change.newMonthlyEquivalent,
      delta,
      currency: change.currency,
      effectiveDate: change.occurredAt,
    });
  }
  return movements;
}

export interface MrrMovementSummary {
  currency: string;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  reactivationMrr: number;
  /** `newMrr + expansionMrr + contractionMrr + churnedMrr + reactivationMrr` — the net MRR change this period, for this currency. */
  netChange: number;
}

/** Aggregates a flat movement list into one summary row per currency — what the dashboard's "New MRR" / "Churned MRR" / "Expansion" / "Contraction" tiles read directly. */
export function summarizeMovements(movements: MrrMovement[]): MrrMovementSummary[] {
  const totals = new Map<string, MrrMovementSummary>();
  for (const movement of movements) {
    const existing = totals.get(movement.currency) ?? {
      currency: movement.currency,
      newMrr: 0,
      expansionMrr: 0,
      contractionMrr: 0,
      churnedMrr: 0,
      reactivationMrr: 0,
      netChange: 0,
    };
    switch (movement.type) {
      case "NEW":
        existing.newMrr += movement.delta;
        break;
      case "EXPANSION":
        existing.expansionMrr += movement.delta;
        break;
      case "CONTRACTION":
        existing.contractionMrr += movement.delta;
        break;
      case "CHURN":
        existing.churnedMrr += movement.delta;
        break;
      case "REACTIVATION":
        existing.reactivationMrr += movement.delta;
        break;
    }
    existing.netChange += movement.delta;
    totals.set(movement.currency, existing);
  }
  return Array.from(totals.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}
