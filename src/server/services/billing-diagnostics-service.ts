import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { billingWebhookEventRepository } from "@/server/repositories/billing-webhook-event-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { subscriptionRepository } from "@/server/repositories/subscription-repository";
import { isStripeConfigured } from "@/config/environment";
import { computeCreditBalance } from "@/lib/billing/ledger";
import { resolvePeriod } from "@/lib/billing/reporting/period";
import {
  checkInvoiceBalanceIntegrity,
  checkRefundDoesNotExceedPayment,
  checkCreditBalanceNeverNegative,
  checkUnrelatedDebitEntries,
  checkSubscriptionStateConsistency,
  checkStalePendingWebhooks,
  checkDuplicateLookingPayments,
  checkTaxComponentSumMismatch,
  type BillingAnomaly,
} from "@/lib/billing/reporting/anomalies";

/**
 * The billing operational control center (spec §16/§17) — primarily
 * DIAGNOSTIC (spec's own explicit instruction): every function here
 * reads and reports, never mutates. `/admin/billing/controls` is the
 * one UI surface this serves.
 *
 * Deliberately does NOT run a live per-organization Stripe
 * reconciliation sweep on every page load — that would mean one live
 * API call per organization with a subscription, an unacceptable
 * cost/latency profile for a page render (spec §23: "performance...
 * document performance characteristics"). Instead this surfaces LOCAL
 * signals that require no provider call at all (webhook failure/
 * staleness counts, `isStripeConfigured`) and links out to the
 * existing PER-ORGANIZATION on-demand reconciliation check
 * (`billing-reconciliation-service.ts`, Module 14's own
 * `reconcileOrganizationBilling()` — reused as-is, never duplicated)
 * for a deeper, deliberately-triggered dive. See
 * `billing-financial-controls.md` "Why no platform-wide live sweep."
 *
 * Also deliberately NOT wired in here: `checkLargeUnexplainedMovement()`
 * (implemented and independently unit-tested in `anomalies.ts`). It
 * needs a `previousMrr`/`currentMrr` pair PER subscription, which this
 * module's MRR movement engine does not currently expose as a
 * per-subscription time series (only currency-level aggregate
 * new/expansion/contraction/churn/reactivation totals — see
 * `mrr-service.ts`'s `getPlatformMrrMovement()`). Building that
 * per-subscription series would mean either a new derived query per
 * anomaly-report load (a real cost, same concern as the live-Stripe-
 * sweep case above) or a new persisted history — out of scope for this
 * module's stated database rules ("prefer derived reporting... a
 * snapshot table requires explicit justification"). Documented rather
 * than wired in half-heartedly; see `financial-controls.md`'s own
 * "Known limitations" section.
 *
 * Module 16 ADDS `checkTaxComponentSumMismatch()` — an integrity signal
 * ("did the two independent tax-write-paths agree"), not itself
 * compliance REPORTING data, so it stays under this control center's
 * existing `billing.controls.read` gate rather than the new, narrower
 * `billing.compliance.read` (see `tax-compliance.md` "Where the tax
 * integrity check lives, and why").
 */

export interface WebhookHealth {
  countsByStatus: Record<"PENDING" | "PROCESSED" | "FAILED" | "IGNORED", number>;
  mostRecentEventAt: Date | null;
  staleAnomalies: BillingAnomaly[];
}

export interface ProviderConnectivity {
  configured: boolean;
}

export interface ConsistencyDiagnostics {
  invoiceBalanceAnomalies: BillingAnomaly[];
  refundAnomalies: BillingAnomaly[];
  creditBalanceAnomalies: BillingAnomaly[];
  creditRelationAnomalies: BillingAnomaly[];
  subscriptionStateAnomalies: BillingAnomaly[];
  duplicatePaymentAnomalies: BillingAnomaly[];
  /** Module 16 — see `checkTaxComponentSumMismatch()`'s own doc comment. */
  taxComponentAnomalies: BillingAnomaly[];
}

export interface ControlCenterReport {
  asOf: Date;
  webhookHealth: WebhookHealth;
  providerConnectivity: ProviderConnectivity;
  consistency: ConsistencyDiagnostics;
  totalAnomalyCount: number;
}

const DUPLICATE_PAYMENT_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000; // scan the last 24h of payments for the duplicate-looking heuristic — a bounded, recent window, not the platform's full payment history

/** `billing.controls.read` — the full diagnostic sweep, platform-wide. */
export async function getControlCenterReport(): Promise<ControlCenterReport> {
  await requirePermission("billing.controls.read");
  const asOf = new Date();

  const [countsByStatus, mostRecentEvent, pendingEvents] = await Promise.all([
    billingWebhookEventRepository.countByStatus(),
    billingWebhookEventRepository.findMostRecent(),
    billingWebhookEventRepository.listRecent(200, { status: "PENDING" }),
  ]);

  const webhookHealth: WebhookHealth = {
    countsByStatus,
    mostRecentEventAt: mostRecentEvent?.receivedAt ?? null,
    staleAnomalies: checkStalePendingWebhooks(pendingEvents.map((e) => ({ eventId: e.id, status: e.status, receivedAt: e.receivedAt })), asOf),
  };

  const consistency = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const [openInvoices, paymentsWithRefunds, creditEntries, subscriptions, recentPayments, currentMonthLineItemTaxSums] = await Promise.all([
      invoiceRepository.listOpenForAging({ platform: true }, tx),
      paymentRepository.listSucceededWithRefundTotals({ platform: true }, tx),
      creditLedgerRepository.listAll({ platform: true }, tx),
      subscriptionRepository.listWithPricedItems({ platform: true }, tx),
      paymentRepository.listRecentSucceeded({ platform: true }, new Date(asOf.getTime() - DUPLICATE_PAYMENT_SCAN_WINDOW_MS), tx),
      invoiceRepository.listLineItemTaxSumsForPeriod({ platform: true }, resolvePeriod("current_month", "UTC", asOf), tx),
    ]);

    // Invoice balance integrity is checked over a BOUNDED, meaningful
    // slice (open invoices) — not the platform's entire invoice
    // history, which grows unboundedly; a PAID/VOID invoice's own
    // balance was already true at the moment it left the OPEN state and
    // is structurally immutable after (no update path exists for
    // amountPaid/amountDue outside `updateStatusAndAmounts()`, itself
    // only ever called from the webhook reconciliation path).
    const invoiceBalanceAnomalies = checkInvoiceBalanceIntegrity(
      openInvoices.map((i) => ({ invoiceId: i.id, organizationId: i.organizationId, invoiceNumber: i.invoiceNumber, total: i.total, amountPaid: i.amountPaid, amountDue: i.amountDue })),
    );

    const refundAnomalies = checkRefundDoesNotExceedPayment(paymentsWithRefunds.map((p) => ({ paymentId: p.paymentId, organizationId: p.organizationId, paymentAmount: p.amount, totalRefunded: p.totalRefunded })));

    const balancesByOrg = new Map<string, { type: "CREDIT" | "DEBIT"; amount: number }[]>();
    for (const entry of creditEntries) balancesByOrg.set(entry.organizationId, [...(balancesByOrg.get(entry.organizationId) ?? []), { type: entry.type, amount: entry.amount }]);
    const creditBalanceAnomalies = checkCreditBalanceNeverNegative(Array.from(balancesByOrg.entries()).map(([organizationId, entries]) => ({ organizationId, balance: computeCreditBalance(entries) })));

    const creditRelationAnomalies = checkUnrelatedDebitEntries(creditEntries.map((e) => ({ entryId: e.id, organizationId: e.organizationId, type: e.type, relatedEntryId: e.relatedEntryId })));

    const subscriptionStateAnomalies = checkSubscriptionStateConsistency(
      subscriptions.map((s) => ({ subscriptionId: s.id, organizationId: s.organizationId, status: s.status, cancelAtPeriodEnd: s.cancelAtPeriodEnd, canceledAt: s.canceledAt })),
    );

    const duplicatePaymentAnomalies = checkDuplicateLookingPayments(
      recentPayments.map((p) => ({ paymentId: p.id, organizationId: p.organizationId, amount: p.amount, currency: p.currency, createdAt: p.createdAt })),
    );

    const taxComponentAnomalies = checkTaxComponentSumMismatch(currentMonthLineItemTaxSums);

    return { invoiceBalanceAnomalies, refundAnomalies, creditBalanceAnomalies, creditRelationAnomalies, subscriptionStateAnomalies, duplicatePaymentAnomalies, taxComponentAnomalies };
  });

  const totalAnomalyCount =
    webhookHealth.staleAnomalies.length +
    consistency.invoiceBalanceAnomalies.length +
    consistency.refundAnomalies.length +
    consistency.creditBalanceAnomalies.length +
    consistency.creditRelationAnomalies.length +
    consistency.subscriptionStateAnomalies.length +
    consistency.duplicatePaymentAnomalies.length +
    consistency.taxComponentAnomalies.length;

  return { asOf, webhookHealth, providerConnectivity: { configured: isStripeConfigured }, consistency, totalAnomalyCount };
}
