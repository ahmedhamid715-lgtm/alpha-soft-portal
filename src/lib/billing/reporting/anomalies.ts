/**
 * Billing anomaly detection (spec §17) — deterministic rules only, each
 * independently checkable from already-fetched rows. No AI, no
 * probabilistic scoring — every rule below is a fixed, documented
 * threshold or a real accounting-identity check (spec's own explicit
 * instruction: "Do not use AI for financial truth... Start with
 * deterministic rules").
 *
 * Several classes of anomaly the spec names are STRUCTURALLY IMPOSSIBLE
 * in this schema and are deliberately not implemented as runtime checks
 * — documented here rather than padded out as dead code:
 *
 *   - "Subscription without valid billing account" — `Subscription.
 *     billingAccountId` is a real, enforced foreign key (`onDelete:
 *     Cascade`); Postgres itself makes an orphaned reference impossible.
 *   - "Duplicate webhook events" — `BillingWebhookEvent` has a real
 *     `UNIQUE(provider, providerEventId)` constraint (Module 13); two
 *     rows for the same event cannot exist to be detected.
 *   - "Provider reference mismatch" — only one provider (Stripe) is
 *     integrated today; this class of anomaly has no possible instance
 *     to detect against yet.
 *
 * Every rule that IS implemented below still exists as a defense-in-
 * depth DIAGNOSTIC, not a gap in the write-path guards: Module 14's own
 * row-locking already prevents an over-refund or a duplicate credit
 * compensation AT WRITE TIME (see `billing-security.md`'s "Concurrency
 * safety") — these checks independently re-verify the same invariants
 * hold, the honest way to answer "can platform staff investigate a
 * financial discrepancy without modifying financial truth."
 */

export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH";

export interface BillingAnomaly {
  rule: string;
  severity: AnomalySeverity;
  organizationId: string | null;
  resourceType: string;
  resourceId: string;
  description: string;
}

export interface InvoiceForAnomalyCheck {
  invoiceId: string;
  organizationId: string;
  invoiceNumber: string;
  total: number;
  amountPaid: number;
  amountDue: number;
}

/** Real accounting identity: `total = amountPaid + amountDue` must always hold, and neither `amountPaid` nor `amountDue` may be negative. */
export function checkInvoiceBalanceIntegrity(invoices: InvoiceForAnomalyCheck[]): BillingAnomaly[] {
  const anomalies: BillingAnomaly[] = [];
  for (const invoice of invoices) {
    if (invoice.amountDue < 0 || invoice.amountPaid < 0) {
      anomalies.push({
        rule: "invoice_negative_amount",
        severity: "HIGH",
        organizationId: invoice.organizationId,
        resourceType: "invoice",
        resourceId: invoice.invoiceId,
        description: `Invoice ${invoice.invoiceNumber} has a negative amountPaid or amountDue.`,
      });
    } else if (invoice.amountPaid + invoice.amountDue !== invoice.total) {
      anomalies.push({
        rule: "invoice_balance_mismatch",
        severity: "HIGH",
        organizationId: invoice.organizationId,
        resourceType: "invoice",
        resourceId: invoice.invoiceId,
        description: `Invoice ${invoice.invoiceNumber}: amountPaid (${invoice.amountPaid}) + amountDue (${invoice.amountDue}) != total (${invoice.total}).`,
      });
    }
  }
  return anomalies;
}

export interface PaymentRefundsForAnomalyCheck {
  paymentId: string;
  organizationId: string;
  paymentAmount: number;
  totalRefunded: number;
}

/** A defense-in-depth re-verification of the SAME invariant `issueRefund()` already enforces at write time (Module 14, row-locked) — total refunded must never exceed the original payment. */
export function checkRefundDoesNotExceedPayment(payments: PaymentRefundsForAnomalyCheck[]): BillingAnomaly[] {
  const anomalies: BillingAnomaly[] = [];
  for (const payment of payments) {
    if (payment.totalRefunded > payment.paymentAmount) {
      anomalies.push({
        rule: "refund_exceeds_payment",
        severity: "HIGH",
        organizationId: payment.organizationId,
        resourceType: "payment",
        resourceId: payment.paymentId,
        description: `Payment ${payment.paymentId}: total refunded (${payment.totalRefunded}) exceeds the original payment amount (${payment.paymentAmount}).`,
      });
    }
  }
  return anomalies;
}

export interface CreditBalanceForAnomalyCheck {
  organizationId: string;
  balance: number;
}

/** A defense-in-depth re-verification that the append-only credit ledger never sums to a negative balance for any organization — should be structurally impossible given how `issueCredit()`/`adjustCredit()` are the only two writers, but independently checkable without trusting that assumption. */
export function checkCreditBalanceNeverNegative(balances: CreditBalanceForAnomalyCheck[]): BillingAnomaly[] {
  return balances
    .filter((b) => b.balance < 0)
    .map((b) => ({
      rule: "negative_credit_balance",
      severity: "HIGH" as const,
      organizationId: b.organizationId,
      resourceType: "billing_account",
      resourceId: b.organizationId,
      description: `Organization's credit ledger balance is negative (${b.balance}).`,
    }));
}

export interface CreditEntryForAnomalyCheck {
  entryId: string;
  organizationId: string;
  type: "CREDIT" | "DEBIT";
  relatedEntryId: string | null;
}

/** Every DEBIT entry this codebase's own service layer produces (`adjustCredit()`) is a COMPENSATING entry with `relatedEntryId` set. A DEBIT with no relation is an unexpected state given today's only two writers. */
export function checkUnrelatedDebitEntries(entries: CreditEntryForAnomalyCheck[]): BillingAnomaly[] {
  return entries
    .filter((e) => e.type === "DEBIT" && e.relatedEntryId === null)
    .map((e) => ({
      rule: "debit_without_relation",
      severity: "MEDIUM" as const,
      organizationId: e.organizationId,
      resourceType: "credit_ledger_entry",
      resourceId: e.entryId,
      description: `Credit ledger DEBIT entry ${e.entryId} has no relatedEntryId — every DEBIT this platform's own services produce is a compensating entry.`,
    }));
}

export interface SubscriptionStateForAnomalyCheck {
  subscriptionId: string;
  organizationId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
}

/** Two real, checkable nonsensical combinations — a terminal subscription that's ALSO "scheduled to cancel," and a CANCELED subscription with no `canceledAt` timestamp at all. */
export function checkSubscriptionStateConsistency(subscriptions: SubscriptionStateForAnomalyCheck[]): BillingAnomaly[] {
  const anomalies: BillingAnomaly[] = [];
  for (const subscription of subscriptions) {
    if (subscription.status === "INCOMPLETE_EXPIRED" && subscription.cancelAtPeriodEnd) {
      anomalies.push({
        rule: "terminal_subscription_scheduled_to_cancel",
        severity: "LOW",
        organizationId: subscription.organizationId,
        resourceType: "subscription",
        resourceId: subscription.subscriptionId,
        description: `Subscription ${subscription.subscriptionId} is INCOMPLETE_EXPIRED (terminal) but cancelAtPeriodEnd is still true.`,
      });
    }
    if (subscription.status === "CANCELED" && subscription.canceledAt === null) {
      anomalies.push({
        rule: "canceled_without_timestamp",
        severity: "MEDIUM",
        organizationId: subscription.organizationId,
        resourceType: "subscription",
        resourceId: subscription.subscriptionId,
        description: `Subscription ${subscription.subscriptionId} has status CANCELED but no canceledAt timestamp.`,
      });
    }
  }
  return anomalies;
}

export interface WebhookEventForStalenessCheck {
  eventId: string;
  status: string;
  receivedAt: Date;
}

/** A `BillingWebhookEvent` still `PENDING` after `staleAfterMs` has elapsed indicates the async processing itself hung or crashed mid-flight — this is the honest, real version of "webhook repeated beyond expected retry window" (a literal duplicate is impossible — see this file's own top comment — but a stuck-in-flight event is a genuine operational anomaly). Default threshold: 1 hour — generous relative to Stripe's own typical delivery/processing latency (seconds), while avoiding false positives from a request still genuinely in flight. */
export function checkStalePendingWebhooks(events: WebhookEventForStalenessCheck[], asOf: Date, staleAfterMs = 60 * 60 * 1000): BillingAnomaly[] {
  return events
    .filter((e) => e.status === "PENDING" && asOf.getTime() - e.receivedAt.getTime() > staleAfterMs)
    .map((e) => ({
      rule: "stale_pending_webhook",
      severity: "MEDIUM" as const,
      organizationId: null,
      resourceType: "billing_webhook_event",
      resourceId: e.eventId,
      description: `Webhook event ${e.eventId} has been PENDING for over ${Math.round((asOf.getTime() - e.receivedAt.getTime()) / (60 * 1000))} minutes — processing may have crashed mid-flight.`,
    }));
}

export interface PaymentForDuplicateCheck {
  paymentId: string;
  organizationId: string;
  amount: number;
  currency: string;
  createdAt: Date;
}

/**
 * Two SUCCEEDED payments for the SAME organization, SAME amount and
 * currency, within `windowMs` of each other — a deterministic
 * "possible duplicate charge" heuristic (a fixed threshold, not
 * probabilistic). Default window: 5 minutes. Only ever a suggestion for
 * human review, never auto-refunded or otherwise acted on.
 */
export function checkDuplicateLookingPayments(payments: PaymentForDuplicateCheck[], windowMs = 5 * 60 * 1000): BillingAnomaly[] {
  const anomalies: BillingAnomaly[] = [];
  const sorted = [...payments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const previous = sorted[i - 1]!;
    if (
      current.organizationId === previous.organizationId &&
      current.amount === previous.amount &&
      current.currency === previous.currency &&
      current.createdAt.getTime() - previous.createdAt.getTime() <= windowMs
    ) {
      anomalies.push({
        rule: "possible_duplicate_payment",
        severity: "LOW",
        organizationId: current.organizationId,
        resourceType: "payment",
        resourceId: current.paymentId,
        description: `Payment ${current.paymentId} matches payment ${previous.paymentId} in amount/currency, within ${Math.round(windowMs / 1000)}s — possible duplicate charge, not automatically acted on.`,
      });
    }
  }
  return anomalies;
}

export interface MovementForLargeChangeCheck {
  subscriptionId: string;
  organizationId: string;
  type: "EXPANSION" | "CONTRACTION";
  previousMrr: number;
  currentMrr: number;
}

/** A movement whose new value is more than `ratio`x (expansion) or less than `1/ratio` (contraction) of the previous value — a fixed-ratio heuristic (default 3x) flagging an unusually large MRR swing for human review, never auto-corrected. */
export function checkLargeUnexplainedMovement(movements: MovementForLargeChangeCheck[], ratio = 3): BillingAnomaly[] {
  const anomalies: BillingAnomaly[] = [];
  for (const movement of movements) {
    if (movement.previousMrr <= 0) continue; // a 0 -> N change is just NEW/expansion from nothing, not a "swing"
    const changeRatio = movement.currentMrr / movement.previousMrr;
    if (changeRatio >= ratio || changeRatio <= 1 / ratio) {
      anomalies.push({
        rule: "large_mrr_movement",
        severity: "LOW",
        organizationId: movement.organizationId,
        resourceType: "subscription",
        resourceId: movement.subscriptionId,
        description: `Subscription ${movement.subscriptionId}'s MRR changed from ${movement.previousMrr} to ${movement.currentMrr} (${movement.type.toLowerCase()}) — more than ${ratio}x, worth a manual look.`,
      });
    }
  }
  return anomalies;
}
