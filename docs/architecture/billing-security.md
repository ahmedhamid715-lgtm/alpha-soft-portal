# Billing security & trust model (Module 13)

The honest accounting of what this module guarantees and how each is
proven — same discipline `audit-security.md`/`user-security.md`/
`organization-security.md` already established for their own modules.

## Permission set — what was added, and what wasn't

Spec §22 suggested a wide candidate namespace and explicitly warned:
"Do not automatically add every permission above. Determine the minimum
permission set required."

**Organization-scope (existing, reserved by Module 05, now live):**

- `billing.read` — owner + admin (`ORGANIZATION_FULL` in `roles.ts`).
  View this organization's billing account, subscription, and invoices.
- `billing.manage` — owner ONLY (granted directly on the `owner` role,
  never `ORGANIZATION_FULL`). Change plan, payment method, cancel — the
  same owner-only-for-financially-consequential-action precedent
  `ownership.transfer`/`organizations.security.update` already
  established.

**Platform-scope (new this module — three keys, not one broad
"billing.admin"):**

- `billing.readPlatform` — `support_admin`, `platform_admin`,
  `platform_owner`. Operational visibility across every organization's
  billing (spec §24) — never payment credentials.
- `billing.plan.manage` — `platform_admin`, `platform_owner`. Curate the
  platform-wide plan catalog.
- `billing.refund` — `platform_owner` ONLY. Issue a refund on any
  organization's payment — the single most financially consequential
  action this module exposes.

**Evaluated and rejected**: `billing.invoice.read`/`billing.invoice.manage`/
`billing.payment_method.manage` — no capability exists at the
ORGANIZATION level that `billing.read`/`billing.manage` don't already
cover. Invoices are read as part of "this organization's billing," never
as an independently-gated sub-capability with a genuinely different
holder; the same is true for payment-method management (entirely
delegated to the Stripe Billing Portal, gated by the same
`billing.manage` that gates every other plan/payment mutation).

### The three-tier platform reasoning

| Role | `billing.readPlatform` | `billing.plan.manage` | `billing.refund` |
|---|---|---|---|
| `support_admin` | ✓ | | |
| `support_agent` | | | |
| `platform_admin` | ✓ | ✓ | |
| `platform_owner` | ✓ | ✓ | ✓ |

`support_agent` deliberately holds NONE of these — its own role
description ("minimal platform-wide visibility only") already excludes
it from `audit.readPlatform`/`notifications.observability`, and billing
is at least as sensitive. `platform_admin` can operate day-to-day
(view every organization's status, curate the catalog) but cannot move
real money back to a customer — the same owner-only-for-irreversible-
action precedent `billing.manage` itself already establishes, applied
at the platform tier. Proven with real, automated tests
(`refund-service.test.ts`): `platform_admin` and `support_admin` are
both independently denied `issueRefund()`, and the provider is never
even called.

## Tenant isolation

Every organization-scoped billing read/write follows Module 06's
`withTenantContext()` architecture — no service function bypasses it
with a convenient global query (spec §23). Two independent, redundant
layers, both proven, not just one relied on silently:

1. **The permission check** (`requirePermission("billing.read", organizationId)`)
   — resolves the caller's REAL membership in that specific organization;
   a forged `organizationId` for an organization the caller doesn't
   belong to fails here.
2. **RLS** (`billing-rls.test.ts`, 15 tests, real Postgres, the
   restricted `alpha_os_app` role) — even if the permission check were
   somehow bypassed, the underlying query itself can only ever see rows
   for the tenant context it was given.

## Financial integrity

- **Server-derived pricing, always** (spec §26/§43) — every mutation
  that involves money (`startCheckoutForPlanPrice()`,
  `createPlanPrice()`, `issueRefund()`) accepts only an internal id
  (`planPriceId`, `paymentId`) from the client; the actual amount,
  currency, and provider price id are always resolved server-side from
  the internal catalog/database. There is no code path anywhere in this
  module that accepts a client-supplied `amount` to determine what a
  customer pays.
- **Refund amounts are independently bounded** (spec §22/§55 Q22) —
  `issueRefund()` computes `sum(existing SUCCEEDED/PENDING refunds) +
  requested amount` and rejects anything exceeding the original
  `Payment.amount`, server-side, before the provider is ever called.
  Proven with a real regression test: two sequential refunds, the
  second correctly rejected for exceeding the remainder, the third
  (exactly the true remainder) succeeding.
- **Invoice numbers are server-generated** (spec §10) — a real Postgres
  `SEQUENCE`, never a client input, never a raw database id. See
  `lib/billing/invoice-numbering.ts`.
- **Invoice line items are immutable** (spec §11) — enforced
  structurally by RLS (no UPDATE policy exists on
  `invoice_line_items`), not just by service-layer discipline never
  calling an update method that doesn't exist.
- **Refunds never mutate the original payment** (spec §13) — a refund
  is its own row, its own financial event; `Payment.amount` is never
  written to a second time.
- **The credit ledger is append-only** (spec §14/§37) — enforced
  structurally by RLS (no UPDATE/DELETE policy on
  `credit_ledger_entries`, for ANY role including platform staff).
- **Related writes share a transaction** — `withTenantContext()`'s own
  transactional guarantee covers every multi-row write in this module
  (invoice + line items, payment + status update, refund + payment
  status update, subscription + items) — no partially-created financial
  record is possible; a failure rolls back the whole write.

## Sensitive-data handling

- **No raw payment credentials ever reach Alpha OS** (spec §12/§38) —
  Checkout/Billing Portal are entirely Stripe-hosted; there is no card-
  entry form anywhere in this codebase.
- **`Payment` stores only safe, already-tokenized display fields** —
  `paymentMethodType`/`Brand`/`Last4`, exactly what Stripe itself
  already treats as non-sensitive.
- **`BillingWebhookEvent.payload`** (the verified raw event) is never
  rendered to any customer-facing surface and never placed into an
  audit event's own metadata — audit redaction (Module 08) still
  applies to whatever a future caller reads FROM that column, even
  though the column itself isn't redacted at rest (it's genuinely
  internal, platform-observability-only data — see
  `billing-webhooks.md`).
- **Provider errors are mapped, never passed through** (spec §42) —
  `stripe/provider.ts`'s `withStripeErrorMapping()` catches every raw
  Stripe SDK error and re-throws as `ExternalServiceError("Stripe")`; a
  customer or platform-staff caller never sees a raw Stripe error
  message, stack trace, or request parameter echo. Proven live: with no
  `STRIPE_SECRET_KEY` configured in this environment, attempting a
  refund surfaces a clean "Stripe" error in the UI, not a crash — see
  `admin-billing.spec.ts`'s own dedicated test for this (spec §49).

## The 30 adversarial questions (spec §55)

Answered with real, automated regression test evidence, not just
prose — file names are exact.

1. **Can a customer read another organization's invoice?** No —
   `getInvoiceForOrganization()`'s IDOR check + RLS, both independently
   proven (`invoice-payment-service.test.ts` "Org B's owner cannot read
   Org A's specific invoice," `billing-rls.test.ts` "invoices: Org B's
   context cannot see Org A's invoice").
2. **Can a customer read another organization's payment?** No — same
   two-layer proof (`invoice-payment-service.test.ts`, `billing-rls.test.ts`).
3. **Can a customer change another organization's subscription?** No —
   `cancelSubscription()`/`resumeSubscription()`/`startCheckoutForPlanPrice()`
   all call `requirePermission(..., organizationId)` first
   (`subscription-service.test.ts` "Org B's owner cannot start a
   checkout for Org A").
4. **Can a customer submit a forged plan price?** No —
   `startCheckoutForPlanPrice()` rejects a nonexistent/inactive
   `planPriceId` server-side (`subscription-service.test.ts`, two
   dedicated tests).
5. **Can a customer submit a forged amount?** Structurally impossible —
   no mutation in this module accepts a client-supplied `amount` for
   pricing at all (see "Financial integrity" above).
6. **Can a customer submit a forged Stripe customer ID?** No —
   `createBillingPortalSession()`/checkout always look up the
   organization's OWN `providerCustomerId` server-side; no function in
   this module accepts one as input at all (see
   `billing-portal-service.ts`'s own top comment).
7. **Can a customer create a subscription for another organization?**
   No — same as Q3 (`startCheckoutForPlanPrice()`'s own IDOR test).
8. **Can a support user issue an unauthorized refund?** No —
   `support_admin` (`billing.readPlatform` only) is explicitly denied,
   proven with the LITERAL question as the test's own title
   (`refund-service.test.ts`).
9. **Can an organization admin elevate themselves to billing
   administrator?** No — `billing.manage` is granted directly to the
   `owner` role only, never `ORGANIZATION_FULL`; an admin holds
   `billing.read` and nothing more (`subscription-service.test.ts`
   "admin ... cannot start a checkout").
10. **Can a suspended organization continue modifying billing?** Yes,
    architecturally unchanged from Module 06/11: `resolveOrganizationContext()`
    zeroes ALL permissions (including `billing.manage`) for any
    non-`ACTIVE` organization — this module adds nothing new here and
    relies on that already-proven guarantee.
11. **Can an archived organization modify billing?** Same as Q10.
12. **Can a revoked membership continue using an existing billing
    session?** Unchanged Module 04/06 session/membership-revocation
    guarantee — not touched by this module.
13. **Can duplicate webhooks create duplicate invoices?** No —
    `invoice.created` is find-or-create by `providerInvoiceId`, and the
    outer `BillingWebhookEvent` idempotency guard means the handler
    only ever runs once per real event regardless (`billing-webhook-service.test.ts`
    "the SAME event.id delivered twice").
14. **Can duplicate webhooks create duplicate payments?** No — same
    find-or-create-by-`providerPaymentId` pattern in
    `handlePaymentIntentEvent()`/`handleInvoiceStatusChange()`.
15. **Can out-of-order events overwrite newer subscription state?** No
    — the `providerEventTimestamp` guard, proven with a real regression
    test (`billing-webhook-service.test.ts` "an out-of-order event...
    is ignored").
16. **Can a webhook bypass tenant authorization?** N/A by design — a
    webhook has no tenant/user identity to "bypass" in the first place;
    it writes via the explicit platform-context bypass
    (`isPlatformStaff: true`), the same honest, documented shape every
    other system-initiated write in this codebase uses.
17. **Can a malicious user replay a webhook?** No — idempotency (Q13/14)
    makes a replay a safe no-op regardless of who sends it; a replayed
    event still needs a VALID signature to be accepted at all (see
    Q18).
18. **Can a malicious user forge a webhook?** No — signature
    verification (`webhook.ts`) rejects any request without a valid
    `Stripe-Signature` for the configured `STRIPE_WEBHOOK_SECRET` before
    anything else runs.
19. **Can raw Stripe secrets enter logs?** No — `logger.warn()` calls in
    `stripe/provider.ts` log only `error.type`/`error.code` (Stripe's
    own safe, classified fields), never the full error object or
    request parameters.
20. **Can payment credentials enter the database?** No — see "Sensitive-
    data handling" above; structurally impossible given no card-entry
    form exists.
21. **Can invoice history be mutated?** No — RLS has no UPDATE policy on
    `invoice_line_items` at all (`billing-rls.test.ts` "no UPDATE policy
    exists at all (immutable)"); `Invoice`'s own status/amount fields DO
    update (a real invoice's status legitimately changes as it's paid),
    but never its line items.
22. **Can refund amounts exceed the original payment?** No — see
    "Financial integrity" above (`refund-service.test.ts`, two
    dedicated tests).
23. **Can concurrent plan changes corrupt subscription state?** No
    corruption possible — every user-initiated plan change is an
    INTENT (a Checkout Session request); the actual state transition
    only ever happens via a single, idempotent, out-of-order-guarded
    webhook write.
24. **Can two billing accounts be created for one organization?** No —
    `BillingAccount.organizationId` is a real, structural `@unique`
    constraint, and `getOrCreateBillingAccount()` is find-or-create,
    proven idempotent under direct testing
    (`billing-account-service.test.ts` "getOrCreateBillingAccount is
    idempotent").
25. **Can platform billing views leak customer payment details?** No —
    `billing-platform-service.ts`'s own return shapes deliberately
    exclude anything beyond safe display fields; no function in that
    file returns a raw Stripe payload or full payment-method number.
26. **Can organization switching expose previous organization's billing
    data?** No — unchanged Module 06 guarantee (every billing read
    independently re-resolves `resolveOrganizationContext(id)` from the
    URL param, never a cached/switched "current org" assumption).
27. **Can browser back-navigation expose stale billing data?** No —
    unchanged Module 06 guarantee (every page is server-rendered fresh
    on each request; nothing is client-cached).
28. **Can a client alter invoice totals?** No — invoices are only ever
    written by the webhook processor, from Stripe's own event data;
    there is no client-facing mutation path for `Invoice.total`/
    `subtotal`/`taxTotal`/etc. at all.
29. **Can a client alter currency?** No — same as Q28; additionally,
    `startCheckoutForPlanPrice()` independently verifies the selected
    price's currency matches the billing account's own currency before
    ever calling the provider.
30. **Can provider failure corrupt local state?** No — every Stripe SDK
    call is wrapped in `withStripeErrorMapping()`
    (`stripe/provider.ts`), which never writes to Postgres itself (see
    that file's own top comment: "nothing here writes to Postgres at
    all"). A Stripe outage surfaces as a clean `ExternalServiceError`
    to the caller; no partial/corrupted local row is ever created as a
    side effect of a failed provider call, proven live in this exact
    environment (no Stripe key configured) — see
    `admin-billing.spec.ts`'s dedicated test.

## What was evaluated and deliberately not built

- **Fine-grained per-invoice/per-payment permissions** — see "Permission
  set" above.
- **A customer self-service refund flow** — refunds are platform-staff-
  initiated only (spec's own Q8 framing); no organization owner/admin
  permission grants refund capability on their own payments.
- **Session-duration/idle-timeout enforcement for billing pages** — out
  of this module's scope entirely; billing pages use the same session
  model every other authenticated page in this codebase does (Module
  04/06), unchanged.
- **A complex tax engine, coupon/promotion engine, or automated
  reconciliation job** — see `billing.md` "Deferred functionality" and
  `billing-webhooks.md`'s own event-mapping table.
