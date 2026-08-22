# Financial controls & anomaly detection (Module 15)

The billing operational control center (`/admin/billing/controls`,
`billing.controls.read`) — `billing-diagnostics-service.ts`'s
`getControlCenterReport()`. Primarily DIAGNOSTIC: every function here
reads and reports, it never mutates a financial record. See
`billing-reconciliation.md` for the separate, deeper per-organization
Stripe-divergence check this page links out to rather than duplicates.

## Why no platform-wide live Stripe sweep

This page deliberately does NOT run a live per-organization Stripe
reconciliation call on every page load — that would mean one live API
call per organization with a subscription, an unacceptable cost/latency
profile for a page render. Instead it surfaces LOCAL signals that
require no provider call at all (webhook failure/staleness counts,
`isStripeConfigured`) and links out to the existing PER-ORGANIZATION
on-demand reconciliation check (`billing-reconciliation-service.ts`,
Module 14's own `reconcileOrganizationBilling()`, reused as-is) for a
deliberately-triggered deeper dive.

## Provider synchronization signals

| Signal | Source | Meaning |
|---|---|---|
| Stripe configured | `isStripeConfigured` | Whether a Stripe secret key exists in this environment — a zero-cost local check, not a live API call. |
| Last webhook received | Most recent `BillingWebhookEvent` of any status/type | A local proxy for "is Stripe actually reaching us," without an extra live call. |
| Pending / Failed counts | `BillingWebhookEventRepository.countByStatus()` | Raw operational counts. |

## Anomaly rules

Every rule is a fixed, documented threshold or a real accounting-
identity check — no AI, no probabilistic scoring (spec's own explicit
instruction). Every rule is independently unit-tested
(`tests/unit/lib/billing/reporting/anomalies.test.ts`).

| Rule | Severity | Check | Scope |
|---|---|---|---|
| `invoice_negative_amount` | HIGH | `amountDue < 0` or `amountPaid < 0` | Open invoices only |
| `invoice_balance_mismatch` | HIGH | `amountPaid + amountDue != total` | Open invoices only |
| `refund_exceeds_payment` | HIGH | Total refunded on a payment exceeds the payment's own amount | All succeeded payments with refunds |
| `negative_credit_balance` | HIGH | An organization's computed credit ledger balance is negative | All organizations with ledger entries |
| `debit_without_relation` | MEDIUM | A `DEBIT` credit-ledger entry has no `relatedEntryId` | All credit ledger entries |
| `terminal_subscription_scheduled_to_cancel` | LOW | `status = INCOMPLETE_EXPIRED` AND `cancelAtPeriodEnd = true` | All subscriptions |
| `canceled_without_timestamp` | MEDIUM | `status = CANCELED` AND `canceledAt = null` | All subscriptions |
| `stale_pending_webhook` | MEDIUM | A `BillingWebhookEvent` still `PENDING` more than 1 hour after receipt | Recent pending events (bounded, `listRecent(200, {status: "PENDING"})`) |
| `possible_duplicate_payment` | LOW | Two SUCCEEDED payments, same org/amount/currency, within 5 minutes of each other | Payments in the trailing 24 hours only (bounded scan window) |

All rules are advisory, surfaced for human review — none is ever
auto-acted-on (no auto-refund, no auto-correction). Several rules are
explicitly framed as DEFENSE-IN-DEPTH re-verification of an invariant
Module 14's own write-time guards (row-locked refund/credit logic) already
enforce — the honest answer to "can platform staff investigate a
financial discrepancy without modifying financial truth," not a
statement that the write path itself is unguarded.

## Structurally impossible anomaly classes (not implemented, and why)

Three anomaly classes the spec names are impossible to observe in this
schema — documented here rather than padded out as dead runtime checks
that could never fire:

1. **"Subscription without valid billing account"** — `Subscription.billingAccountId`
   is a real, enforced foreign key (`onDelete: Cascade`); Postgres
   itself makes an orphaned reference impossible.
2. **"Duplicate webhook events"** — `BillingWebhookEvent` has a real
   `UNIQUE(provider, providerEventId)` constraint (Module 13); two rows
   for the same event cannot exist to be detected.
3. **"Provider reference mismatch"** — only one provider (Stripe) is
   integrated today; this class of anomaly has no possible instance to
   detect against yet.

## Known limitation: `checkLargeUnexplainedMovement()`

Implemented and independently unit-tested (`anomalies.ts`) — flags a
per-subscription MRR swing of more than a fixed ratio (default 3x) as
worth a manual look — but deliberately NOT wired into the control
center report. It needs a `previousMrr`/`currentMrr` PAIR per
subscription, which this module's MRR movement engine does not
currently expose as a per-subscription time series — only
currency-level AGGREGATE totals (new/expansion/contraction/churn/
reactivation, see `revenue-metrics.md`). Building that per-subscription
series would mean either a new derived query on every control-center
page load (the same cost concern that already ruled out a live
platform-wide Stripe sweep, above) or a new persisted history — which
this module's own database rules require explicit justification for
before building (see `billing-intelligence.md` "No new database
table"). Documented rather than wired in half-heartedly; a future
module that needs per-subscription MRR trend data can build the
supporting query with this exact requirement already spelled out.

## Data-consistency scan scope

Every consistency check runs over a BOUNDED, meaningful slice of data,
never the platform's unbounded full history:

- Invoice balance integrity — open invoices only. A PAID/VOID invoice's
  balance was already true the moment it left the OPEN state and is
  structurally immutable after (no update path exists for
  `amountPaid`/`amountDue` outside the webhook reconciliation path).
- Duplicate-payment scan — the trailing 24 hours of succeeded payments
  only.
- Stale-webhook scan — the most recent 200 still-`PENDING` events.

## Audit coverage

- `billing.reconciliation.divergence_detected` — recorded on a REAL
  divergence found by `reconcileOrganizationBilling()` (either a
  field-level diff or a fully-missing remote subscription), attributed
  to the platform-staff caller. A routine "no divergence" result is
  deliberately NOT audited — the same "audit the outcome, not every
  routine read" discipline `billing.webhook.processed`'s own reserved
  catalog entry already establishes. Proven by
  `billing-reconciliation-service.test.ts` (exact audit-event counts:
  0 for a matching check, 1 for each real-divergence case).
- The control center report ITSELF is not separately audited — it's a
  read, gated by `billing.controls.read` like any other permissioned
  view; only the underlying mutations it can link out to (refund,
  credit issuance, plan change, reconciliation divergence) carry their
  own audit entries, all pre-existing from Module 13/14 except the
  reconciliation-divergence entry above.
