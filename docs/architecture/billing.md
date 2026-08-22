# Billing (Module 13 — Enterprise Billing, Plans & Subscription Infrastructure)

Establishes the enterprise billing foundation for Alpha OS — a clean
internal billing domain, independent of any specific payment provider
(spec §2). See `billing-provider.md` for the provider abstraction,
`billing-data-model.md` for the full schema/ownership classification,
`billing-webhooks.md` for reconciliation, and `billing-security.md` for
the full trust model and adversarial review. Module 14 (Billing
Operations, Subscription Lifecycle & Revenue Management) builds directly
on this foundation — see `billing-operations.md` for the day-to-day
operational surface (plan changes, credits, trials, cancellation),
`subscription-lifecycle.md` for the subscription state machine, and
`billing-reconciliation.md` for how divergence from Stripe is detected.

## Billing ownership

Billing belongs to an ORGANIZATION, never a user (spec §4). A customer
may have multiple users; users may change; the organization is the
durable commercial entity. `BillingAccount` (1:1 with `Organization`,
lazily created — no row exists until an organization's first checkout)
is the root of every other billing record.

## Plans and prices

`Plan` (internal name, display name, description, active/inactive,
`metadata`) and `PlanPrice` (currency, minor-unit `unitAmount`,
`MONTH`/`YEAR` interval, provider reference) are deliberately separate
models (spec §6) — the same plan can have several active prices
(monthly/annual, future currencies, grandfathered pricing) without the
plan concept itself changing. Nothing in the UI hardcodes plan names or
prices — every customer-facing plan picker (`PlanPicker`, `/organizations/
[id]/billing`) and every platform admin catalog view (`/admin/plans`)
reads from these two tables.

There is deliberately no `PlanFeature` table — see
`billing-data-model.md` "What was evaluated and deliberately not
modeled."

## Subscriptions

`Subscription` (one organization, `Alpha OS domain status — spec §8`:
`TRIALING`/`ACTIVE`/`PAST_DUE`/`PAUSED`/`CANCELED`/`INCOMPLETE`/
`INCOMPLETE_EXPIRED`/`UNPAID`) + `SubscriptionItem[]` (spec §9 — a
subscription is never "one subscription = one price forever"; seats,
add-ons, and future usage-based items are all just more rows here, even
though this module's own UI only exercises the single-item case).
Cancellation never deletes history (spec §28) — `cancelAtPeriodEnd` /
`canceledAt` / `status` transition on the SAME row; a genuine "start a
new subscription" (e.g. after a full cancellation) creates a new row,
leaving the old one as a permanent historical record.

### Plan changes (spec §26)

`startCheckoutForPlanPrice()` is used for BOTH starting a first
subscription and changing to a different plan — the client submits only
an internal `planPriceId`; the server independently verifies it's
active, resolves the real provider price/amount/currency, and creates a
Stripe Checkout Session. See `billing-security.md` for the full forged-
input adversarial proof.

### Cancellation (spec §28)

`cancelSubscription({ atPeriodEnd })` — defaults to `true` (the
reversible path; `resumeSubscription()` undoes it any time before the
period actually ends). Immediate cancellation (`atPeriodEnd: false`) is
supported by the service layer but is deliberately NOT exposed as a
one-click self-service UI control — the customer billing dashboard only
ever offers the at-period-end path, leaving immediate cancellation to a
support-assisted flow. This is a UI-scope decision, not a service-layer
limitation.

### Proration (spec §27)

Not modeled explicitly by this module. Alpha OS delegates proration
entirely to Stripe's own default behavior for subscription/price
changes made through Checkout — this module does not compute, display,
or override a proration amount anywhere. Documented here as a
deliberate deferral (spec's own explicit instruction: "if complex
proration is deferred, document it explicitly rather than pretending it
is supported"), not a silent gap. A future module that needs
`Alpha OS` to control proration semantics (immediate vs. next-period,
credit-vs-charge display) has a real, empty extension point: the
webhook processor already reconciles whatever Stripe actually did, so
adding proration-aware invoice line items is additive, not a rewrite.

## Invoices

`Invoice` + `InvoiceLineItem[]` (spec §10/§11) — a pragmatic, universal
lifecycle (`DRAFT`/`OPEN`/`PAID`/`VOID`/`UNCOLLECTIBLE`) rather than a
blind mirror of Stripe's own invoice statuses. Every amount (`subtotal`/
`discountTotal`/`taxTotal`/`total`/`amountPaid`/`amountDue`) is an `Int`
of minor units.

### Invoice numbering (spec §10)

`INV-{year}-{6-digit sequence}` (e.g. `INV-2026-000042`) —
`lib/billing/invoice-numbering.ts`, backed by a real Postgres
`SEQUENCE` (`invoice_number_seq`), never a database id, never
client-supplied. The sequence is GLOBAL, not reset per year — the year
in the formatted number is presentational only. Sequences are
intentionally non-transactional in Postgres, so a failed invoice-
creation attempt legitimately leaves a gap; uniqueness and monotonic
increase are the real guarantees, not strict contiguity (see that
file's own doc comment).

### Immutable invoice lines (spec §11)

`InvoiceLineItem` rows are written ONCE, at `invoice.created`, from
Stripe's own line data, and never updated again — enforced structurally
by RLS (no UPDATE policy exists on that table at all, not just a
service-layer convention; see `billing-data-model.md`). Historical
invoices remain historically accurate even if a plan's current pricing
later changes.

## Payments

`Payment` — provider reference, minor-unit `amount`/`currency`, status
(`PENDING`/`SUCCEEDED`/`FAILED`/`REFUNDED`/`PARTIALLY_REFUNDED`), and
ONLY safe, already-tokenized payment-method display fields (spec §12) —
never a raw card number, CVV, or full credential; see
`billing-security.md`.

## Refunds

`Refund` (spec §13) — its own row, its own financial event; the
original `Payment.amount` is never mutated to represent one. Only
reachable via `issueRefund()`, platform-staff-only
(`billing.refund`, `platform_owner`-only — see `billing-security.md`),
with the refund amount independently bounded against what remains
refundable on that specific payment. `charge.refunded` webhook handling
also reconciles a refund issued directly in the Stripe dashboard, so
Alpha OS's own history stays complete regardless of where a refund
originated.

## Credits

`CreditLedgerEntry` — an append-only, `CREDIT`/`DEBIT` ledger (spec
§14), never a mutable balance column. `lib/billing/ledger.ts`'s
`computeCreditBalance()` sums the ledger fresh on every read; no cached
balance exists anywhere in this module. Structurally append-only: RLS
grants INSERT/SELECT only, for every role including platform staff (see
`billing-data-model.md`).

There is no service-layer function that ISSUES a credit yet in this
module — the ledger model, repository, and balance computation exist
and are fully tested (`billing-rls.test.ts`), but no real business
event in Module 13 currently produces one (no proration-credit, no
goodwill-credit flow). This is an honest, documented gap: the
architecture is ready for a future module to add "issue a goodwill
credit" as a platform action without a schema change, not a claim that
credits are already in active use.

## Tax and discounts (spec §35/§36)

`Invoice`/`InvoiceLineItem` both carry `taxAmount`/`discountAmount`
fields and can represent them without corrupting monetary totals — but
no real tax CALCULATION engine exists in this module. Tax/discount
amounts are recorded exactly as Stripe itself computed and reported
them on the underlying invoice/line item; Alpha OS never independently
calculates a tax rate or applies a coupon rule of its own. A future
module integrating Stripe Tax (or a dedicated coupon/promotion engine)
extends this model additively — the columns already exist to hold real
values once a real calculation produces them.

## Notifications (Module 09 integration)

New category: `BILLING` (IN_APP mandatory, EMAIL default-on but user-
optional — its own reasoning in `categories.ts`'s doc comment).
Templates: `billing.subscription.created`, `billing.subscription.past_due`,
`billing.subscription.canceled`, `billing.invoice.created`,
`billing.payment.succeeded`, `billing.payment.failed`. Recipients are
always owner + admin only (the same audience `billing.read`/
`billing.manage` are granted to) — a `member`/`viewer` cannot see
billing at all, so a billing notification isn't meaningful to them.

`billing.subscription.updated` fires on every reconciled webhook,
including routine period renewals with no status change — the
subscriber (`subscribers.ts`) only notifies on the two transitions
that are actually worth a user's attention (newly `PAST_DUE`, newly
`CANCELED`), a deliberate anti-spam filter (spec §29: "do not spam
users").

**Not built**: a `trial_ending` reminder — no trial-period UI/flow
exists yet in this module for it to be meaningful; the template/event
name is a natural, real future addition once trials are actually
offered, not a placeholder built ahead of need. A `billing_account.
suspended` notification also is not built — `updateBillingAccountStatus()`
is a rare, platform-owner-only administrative action without an
established "notify the customer" flow yet; a future module can add
this the same way Module 11 added organization lifecycle notifications.

## Audit (Module 08 integration)

New `AuditCategory`: `BILLING` — its own category, not folded into
`ORGANIZATION`/`ADMINISTRATION` (spec's own "financial/security
subsystem" framing already justifies SECURITY/COMPLIANCE as their own
categories; billing deserves the same independent filterability).
Actions: `billing.account.created`/`.updated`, `billing.subscription.
created`/`.updated`/`.canceled`/`.resumed`, `billing.plan.changed`
(reserved — see below), `billing.plan.catalog_updated`, `billing.
payment_method.updated` (reserved — see below), `billing.invoice.
created`, `billing.payment.succeeded`/`.failed`, `billing.refund.
created`. Every sensitive billing action — every webhook-driven state
change, every platform admin catalog edit, every refund — produces
exactly one of these. `billing.plan.changed` is `reserved: true`: the
catalog entry exists (a future module tracking WHICH organization moved
from WHICH plan to WHICH plan, distinct from the generic subscription-
updated event, has a real key to reference), but no current call site
emits it — `billing.subscription.updated` already covers the
underlying state change; `billing.payment_method.updated` is likewise
reserved (see `billing-webhooks.md`'s "intentionally unsupported
events" — Alpha OS never directly observes a distinct payment-method-
change signal from the Billing Portal flow).

## UI surfaces

**Customer** (`/organizations/[id]/billing/*`, gated by
`billing.read`/`billing.manage`):
- `/billing` — current plan, subscription status, renewal date, amount,
  payment status; plan picker when no active subscription; cancel/
  resume; "Manage payment method" (Billing Portal redirect).
- `/billing/invoices` — cursor-paginated invoice list.
- `/billing/invoices/[invoiceId]` — line items, hosted invoice link.

**Platform** (`/admin/billing/*`, `/admin/plans`, gated by
`billing.readPlatform`/`billing.plan.manage`/`billing.refund`):
- `/admin/billing` — every organization's billing account status +
  current subscription status, platform-wide, cursor-paginated.
- `/admin/billing/organizations/[id]` — one organization's billing
  detail: account status, subscription, recent invoices/payments, and
  (only for a `billing.refund` holder) a Refund action per payment.
- `/admin/plans` — the plan/price catalog: create a plan, add a price
  (major-unit input, converted server-side), activate/deactivate.

Every page uses Module 02's existing design system components
(`PageHeader`/`SectionHeader`/`MetricCard`/`StatusBadge`/`DataTable`-
adjacent plain tables for cursor-paginated lists/`ConfirmDialog`/
`EmptyState`) — no new visual system was invented.

## Reconciliation (spec §48)

`billing-webhook-service.ts` IS the reconciliation boundary — it
compares "what Stripe just reported" against "what Alpha OS currently
has" on every event (find-or-create, out-of-order-guarded update) and
resolves any disagreement in Stripe's favor (Stripe owns provider
subscription/invoice/payment execution state — see `billing-webhooks.md`
"User action vs. provider event"). This module does not implement a
separate, scheduled, full-catalog reconciliation JOB (comparing
EVERY Alpha OS record against Stripe's API on a cron) — that's real,
valuable future infrastructure (spec's own "does not need to implement
a complete nightly reconciliation engine if that belongs to a future
module"), and the architecture is ready for it: `billing-platform-
service.ts`'s `listRecentWebhookEventsForPlatform()` already surfaces
`FAILED` events for manual review today, and a future scheduled job
would use the exact same repository/service functions this module
already built, not a parallel set.

## Deferred functionality (spec §59 — explicitly not built)

Advanced usage-based billing, a complex tax engine, a full coupon/
promotion engine, automated reconciliation jobs, advanced dunning
beyond Stripe's own default retry schedule, multi-provider failover,
revenue recognition, accounting integrations, full financial reporting,
subscription analytics, metered usage ingestion, advanced billing
automation. Every one of these has a real, documented extension point
in this module's architecture (the provider abstraction, the ledger
model, the webhook event-type dispatch table) — none require a rewrite
to add later.
