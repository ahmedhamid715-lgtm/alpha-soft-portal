import type { SubscriptionStatus, BillingInterval } from "@/generated/prisma/client";
import { addMoney } from "@/lib/utils/money";

/**
 * The MRR engine (spec §2) — a pure, deterministic function over
 * already-fetched, authoritative rows. No database access here; the
 * service layer (`server/services/mrr-service.ts`) is responsible for
 * fetching exactly the right rows (tenant-scoped, via
 * `withTenantContext()`) and handing them to this module.
 *
 * MRR is a CONTRACTUAL-RECURRING-VALUE metric, not a cash metric and
 * not a GAAP revenue-recognition metric — see `billing-intelligence.md`
 * and `revenue-metrics.md` for the full accounting-semantics disclaimer.
 * This file computes exactly one thing: "if every currently-included
 * subscription renewed today at its current price, what would the
 * platform bill next month" — nothing about cash actually collected,
 * discounts not representable in the current schema, or recognized
 * revenue enters this calculation.
 */

/** Statuses whose subscriptions count toward MRR — and the documented reasoning for each inclusion/exclusion, spec §2's own explicit requirement ("For every metric: define inclusion/exclusion rules"). */
export const MRR_INCLUDED_STATUSES: readonly SubscriptionStatus[] = ["ACTIVE", "PAST_DUE"];
/**
 * Excluded, with reasons (not merely "everything else"):
 *   - TRIALING — no committed recurring revenue exists yet; mainstream
 *     SaaS MRR convention (ChartMogul/Baremetrics/ProfitWell all exclude
 *     trials) excludes a subscription that can still convert to $0 with
 *     no charge ever occurring.
 *   - PAUSED — Stripe's own semantics: no billing occurs during a pause,
 *     so there is no current recurring charge to count.
 *   - CANCELED / INCOMPLETE / INCOMPLETE_EXPIRED — no longer, or never
 *     became, a live commercial relationship.
 *   - UNPAID — Stripe's terminal pre-cancellation state (retries
 *     exhausted); kept OUT of headline MRR deliberately (unlike
 *     PAST_DUE, which is still mid-retry and contractually intact) —
 *     surfaced instead via AR aging / financial health as an at-risk
 *     signal, not blended into a number meant to represent healthy
 *     recurring commitment.
 */

export interface SubscriptionItemForMrr {
  planPriceUnitAmount: number;
  planPriceInterval: BillingInterval;
  planPriceCurrency: string;
  quantity: number;
}

export interface SubscriptionForMrr {
  subscriptionId: string;
  organizationId: string;
  status: SubscriptionStatus;
  items: SubscriptionItemForMrr[];
}

/**
 * One subscription item's monthly-equivalent value, in minor units.
 * `MONTH` — the unit amount itself (already a monthly charge).
 * `YEAR` — `round(unitAmount / 12)`, ROUNDED (never truncated) to the
 * nearest minor unit, per-item, THEN multiplied by quantity — rounding
 * per item before summing (rather than rounding a summed total) is the
 * documented, deterministic choice: it means adding a second identical
 * item to a subscription always changes MRR by exactly double the first
 * item's own contribution, with no cross-item rounding interaction.
 *
 * Discounts: this platform's data model has NO subscription-level or
 * plan-price-level discount/coupon concept — `InvoiceLineItem.
 * discountAmount` exists only on an already-issued, immutable invoice
 * line, never as a persistent recurring adjustment to what a
 * subscription bills going forward. MRR is therefore computed from
 * `PlanPrice.unitAmount` directly (the undiscounted catalog rate) — a
 * documented limitation, not an oversight (spec §2: "If the current
 * pricing model does not support a particular... discount concept,
 * explicitly document that limitation").
 */
export function monthlyEquivalent(item: SubscriptionItemForMrr): number {
  const perUnit = item.planPriceInterval === "YEAR" ? Math.round(item.planPriceUnitAmount / 12) : item.planPriceUnitAmount;
  return perUnit * item.quantity;
}

export interface MrrByCurrency {
  currency: string;
  /** Minor units. */
  mrr: number;
  /** `mrr * 12` — see this module's own `computeArr()`. */
  arr: number;
  subscriptionCount: number;
}

/**
 * Sums monthly-equivalent value across every INCLUDED subscription,
 * GROUPED BY CURRENCY (spec §14 — currencies are never summed together;
 * a platform with both USD and EUR customers gets two rows, never one
 * fabricated blended total). Credits are deliberately NEVER subtracted
 * here — see this file's own top comment: MRR is a CONTRACTUAL measure,
 * and a promotional/goodwill credit changes what's actually invoiced or
 * collected, not what the customer is contractually committed to pay
 * going forward. `addMoney()` (the same currency-safe primitive used
 * everywhere else in this codebase) is what actually enforces the
 * never-mix-currencies rule — this function would THROW, not silently
 * combine, if it were ever misused.
 */
export function computeMrrByCurrency(subscriptions: SubscriptionForMrr[]): MrrByCurrency[] {
  const totals = new Map<string, { mrr: number; count: number }>();

  for (const subscription of subscriptions) {
    if (!MRR_INCLUDED_STATUSES.includes(subscription.status)) continue;
    for (const item of subscription.items) {
      const value = monthlyEquivalent(item);
      const existing = totals.get(item.planPriceCurrency);
      if (existing) {
        existing.mrr = addMoney({ minorUnits: existing.mrr, currency: item.planPriceCurrency }, { minorUnits: value, currency: item.planPriceCurrency }).minorUnits;
      } else {
        totals.set(item.planPriceCurrency, { mrr: value, count: 0 });
      }
    }
    // Count the subscription once per currency it actually contributes
    // to (almost always exactly one currency, since a subscription's
    // items all share `BillingAccount.currency` in practice) — counted
    // AFTER the item loop so a subscription with zero items (a real,
    // if unusual, edge case) contributes $0 MRR and no count at all,
    // rather than a phantom currency bucket.
    const currenciesTouched = new Set(subscription.items.map((i) => i.planPriceCurrency));
    for (const currency of currenciesTouched) {
      const bucket = totals.get(currency);
      if (bucket) bucket.count += 1;
    }
  }

  return Array.from(totals.entries())
    .map(([currency, { mrr, count }]) => ({ currency, mrr, arr: computeArr(mrr), subscriptionCount: count }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * ARR = MRR × 12 (spec §3) — derived, never a stored column. This is a
 * simple annualization of CURRENT recurring commitment, not a forecast
 * (no growth/churn assumption is baked in) and not a GAAP annual
 * revenue figure.
 */
export function computeArr(mrrMinorUnits: number): number {
  return mrrMinorUnits * 12;
}
