# Billing operations (Module 14)

The day-to-day operational surface built on top of Module 13's
foundation — plan changes, credits, trial management, and cancellation.
See `subscription-lifecycle.md` for the state machine every mutation
here goes through, and `billing-security.md` for the full permission/
adversarial matrix.

## Provider-aware proration — `previewSubscriptionChange()`/`changeSubscription()`

Two separate provider methods, deliberately not one:

- **`previewSubscriptionChange()`** — read-only, best-effort. Calls
  Stripe's `invoices.createPreview()` with the SAME item/price/quantity
  the apply step would use, so the preview and the apply are guaranteed
  to agree (there's no separate "compute an estimate ourselves" code
  path that could drift from what Stripe would actually charge — spec
  §5's own "never fabricate numbers" is enforced structurally, not by
  discipline). Returns `{available: false, ...}` rather than throwing
  for ANY failure — a real API error, or Stripe being entirely
  unconfigured — because a preview failing must never block the actual
  change from proceeding (see `provider/stripe/provider.ts`'s own
  comment on why `getStripeClient()` itself is inside the protective
  `try`, not called ahead of it).
- **`changeSubscription()`** — the real mutation. Updates the EXISTING
  Stripe subscription item in place (`stripe.subscriptions.update()`),
  never a second Checkout Session — a second session would create a
  SECOND, competing Stripe subscription for the same customer, a real
  bug this module's own `subscription-lifecycle.md` documents as "the
  in-place change bug Module 13 left behind." Like every other mutation
  in this module, writes NOTHING locally — only records intent; the new
  price/item becomes visible once the webhook reconciles it.

Both share one validation helper, `resolvePlanChangeInputs()`, so the
preview and the apply can never validate differently (a price that
passes preview validation is guaranteed to still be checked the
identical way at apply time — re-validated fresh, not cached from the
preview call, since state can change between the two steps).

## Credits — append-only, compensating, never a cached balance

Built directly on Module 13's own `CreditLedgerEntry` model — no schema
redesign, two new nullable columns (`initiatedByUserId`, `relatedEntryId`)
and one new real `UNIQUE` constraint. The ledger's own append-only
principle (spec §14/§37, enforced structurally by RLS having no UPDATE
policy on this table at all) is preserved exactly:

- **`issueCredit()`** — writes a new `CREDIT` entry. `billing.credit.
  manage`, platform staff only (never customer self-service — see
  `billing-security.md`'s reasoning for why this is grouped with trial
  extension, not with `billing.refund`).
- **`adjustCredit()`** — never updates or deletes the original entry.
  Writes a NEW, opposite-type entry (a `CREDIT` gets a `DEBIT`
  compensating entry, and vice versa) linked via `relatedEntryId`, for
  the EXACT amount of the original. A real `@@unique([relatedEntryId])`
  constraint is what actually prevents double-compensation — not an
  application-level "check if already adjusted" query, which would have
  the same read-then-write race the rest of this module's own
  concurrency work exists to close.
- **`getCreditBalance()`** — `computeCreditBalance(entries)` (`lib/
  billing/ledger.ts`), a pure sum over every entry, computed fresh on
  EVERY call. There is no `BillingAccount.creditBalance` column and
  never will be one — a cached balance is exactly the kind of "two
  sources of truth that can drift" this whole module's reconciliation
  discipline exists to avoid, and the ledger for one organization is
  small enough (dozens of rows, not millions) that summing it on every
  read is the correct, simple choice over a maintained cache with its
  own invalidation bugs waiting to happen.

## Trial extension

`extendTrial()` — same `billing.credit.manage` permission (see
`billing-security.md` for why credits and trial extension share one
permission). Validates the subscription is genuinely `TRIALING` with a
real `trialEnd` before doing anything, computes the new trial end by
adding `additionalDays` (1–90, Zod-bounded) to the CURRENT `trialEnd`
(never to "now" — extending from the existing end date, not resetting
the clock), calls `stripeBillingProvider.extendTrial()`, and — like
every other mutation in this module — never writes `trialEnd` locally
itself. The webhook (`customer.subscription.updated`, standard
reconciliation) is what actually updates the local row once Stripe
confirms it.

## Cancellation — exact effective-date messaging

`cancelSubscription({ atPeriodEnd })` defaults to `atPeriodEnd: true`
(reversible via `resumeSubscription()` until the period actually ends) —
immediate cancellation is available (`atPeriodEnd: false`) but
deliberately not the default and not exposed as a one-click customer
self-service control (`SubscriptionControls`'s own comment: "a rarer,
more consequential action left to support-assisted flows"). The UI
always states the EXACT consequence, never a vague "your subscription
will be canceled": the confirm dialog for scheduling a cancellation says
access continues until the end of the current period and can be undone;
once `cancelAtPeriodEnd` is true, the dashboard states the exact date
("scheduled to cancel on {currentPeriodEnd}"), read directly from the
real `Subscription` row, never computed/guessed by the UI itself.

## Reconciliation, health, and what's NOT built here

See `billing-reconciliation.md` for divergence detection.
`computeBillingHealth()` (documented in `subscription-lifecycle.md`) is
the one place `healthy`/`trial`/`payment_due`/`payment_failed`/
`past_due`/`suspended`/`canceled` is decided — derived, never
duplicated.

## Payment failure recovery — `retryInvoicePayment()`

`invoice-service.ts`'s `retryInvoicePayment()` — Stripe's OWN retry
capability (`stripe.invoices.pay()`, one immediate attempt against the
customer's current default payment method) exposed as-is, exactly the
FOUNDATION spec §15 asks for and explicitly not a fake retry engine:
there is no schedule, no backoff, no multi-attempt state tracked in
Alpha OS at all. `billing.manage` (owner self-service, same tier as
changing plan/payment method) — gated to only an `OPEN` invoice with a
real `providerInvoiceId`; writes nothing locally, the outcome arrives via
the normal `invoice.paid`/`invoice.payment_failed` webhook like every
other provider-mediated mutation in this module. Surfaced on the
invoice detail page (`/organizations/[id]/billing/invoices/[invoiceId]`)
only when both conditions hold.

## Deliberately not built

Unchanged from the plan (spec's own explicit list): a coupon/promotion
engine, usage-based billing, multi-currency conversion, a tax engine,
entitlements beyond billing, revenue recognition, or automated
reconciliation repair (see `billing-reconciliation.md`).
