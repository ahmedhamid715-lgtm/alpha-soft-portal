import type { SubscriptionStatus, BillingAccountStatus } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/utils/money";

/**
 * Customer financial health (spec §7) — a TRANSPARENT, deterministic
 * classification from real signals, never a black-box or AI-generated
 * score (spec's own explicit prohibition). Every classification exposes
 * the exact reasons that produced it, built as plain English sentences
 * from the real signal VALUES (a specific invoice number, a specific
 * day count, a specific failure count) — never a bare label with no
 * explanation.
 *
 * Distinct from, and complementary to, Module 14's `lib/billing/
 * health.ts` `computeBillingHealth()`: that function answers "what
 * LIFECYCLE STAGE is this billing account in" (a coarse, ~7-value label
 * driven by `BillingAccountStatus`/`SubscriptionStatus` alone, already
 * used throughout the existing customer/admin billing UI — unchanged by
 * this module). This function answers a different question — "how much
 * FINANCIAL RISK does this account represent to platform operations
 * right now" — by combining MULTIPLE signals (days overdue, consecutive
 * failures, scheduled cancellation, account suspension) that
 * `computeBillingHealth()` deliberately doesn't attempt to weigh
 * against each other. Neither replaces the other; see
 * `billing-intelligence.md` "Two health models, on purpose."
 */

export type FinancialHealthClassification = "HEALTHY" | "WATCH" | "AT_RISK" | "CRITICAL";

export interface FinancialHealthSignals {
  billingAccountStatus: BillingAccountStatus | null;
  subscriptionStatus: SubscriptionStatus | null;
  cancelAtPeriodEnd: boolean;
  /** From the AR aging engine — the WORST (largest) days-overdue figure across this organization's own open invoices; `0` if none are overdue. */
  maxDaysOverdue: number;
  /** The single most-overdue invoice's own number, for the reason string — `null` if `maxDaysOverdue` is 0. */
  mostOverdueInvoiceNumber: string | null;
  /** Count of FAILED `Payment` rows in a fixed, documented trailing window (30 days) — a real, bounded, queryable signal, not an unbounded lifetime count. */
  failedPaymentsLast30Days: number;
  currency: string | null;
}

export interface FinancialHealthResult {
  classification: FinancialHealthClassification;
  reasons: string[];
}

/**
 * Ordered, most-severe-first rule evaluation — the FIRST matching tier
 * wins (a CRITICAL account is never also described as merely AT_RISK).
 * Every threshold below is a plain, fixed, documented number — no
 * learned weight, no probabilistic scoring (spec: "deterministic rules").
 */
function overdueReason(signals: FinancialHealthSignals): string {
  const invoiceRef = signals.mostOverdueInvoiceNumber ? `Invoice ${signals.mostOverdueInvoiceNumber}` : "An invoice";
  const dayWord = signals.maxDaysOverdue === 1 ? "day" : "days";
  return `${invoiceRef} is ${signals.maxDaysOverdue} ${dayWord} overdue.`;
}

export function computeFinancialHealth(signals: FinancialHealthSignals): FinancialHealthResult {
  const reasons: string[] = [];

  if (signals.billingAccountStatus === "SUSPENDED") reasons.push("Billing account is suspended.");
  if (signals.subscriptionStatus === "UNPAID") reasons.push("Subscription is UNPAID — Stripe's own automatic retries have been exhausted.");
  if (signals.maxDaysOverdue >= 60) reasons.push(overdueReason(signals));
  if (reasons.length > 0) return { classification: "CRITICAL", reasons };

  if (signals.maxDaysOverdue >= 30) reasons.push(overdueReason(signals));
  if (signals.failedPaymentsLast30Days >= 2) reasons.push(`${signals.failedPaymentsLast30Days} payments failed in the last 30 days.`);
  if (signals.subscriptionStatus === "PAST_DUE") reasons.push("Subscription is past due.");
  if (reasons.length > 0) return { classification: "AT_RISK", reasons };

  if (signals.cancelAtPeriodEnd) reasons.push("Subscription is scheduled to cancel at the end of the current period.");
  if (signals.maxDaysOverdue >= 1) reasons.push(overdueReason(signals));
  if (signals.failedPaymentsLast30Days === 1) reasons.push("1 payment failed in the last 30 days.");
  if (reasons.length > 0) return { classification: "WATCH", reasons };

  return { classification: "HEALTHY", reasons: ["No overdue invoices, no recent payment failures, no scheduled cancellation."] };
}

export const FINANCIAL_HEALTH_LABELS: Record<FinancialHealthClassification, string> = {
  HEALTHY: "Healthy",
  WATCH: "Watch",
  AT_RISK: "At risk",
  CRITICAL: "Critical",
};

export const FINANCIAL_HEALTH_TONE: Record<FinancialHealthClassification, "success" | "warning" | "destructive"> = {
  HEALTHY: "success",
  WATCH: "warning",
  AT_RISK: "warning",
  CRITICAL: "destructive",
};

/** Convenience for a UI that wants to show the overdue amount alongside the reason — not used by `computeFinancialHealth()` itself (which stays currency-symbol-free in its own reason strings, deliberately, since `signals.currency` may be `null` for an org with no billing account at all). */
export function formatOverdueAmount(amount: number, currency: string): string {
  return formatMoney(amount, currency);
}
