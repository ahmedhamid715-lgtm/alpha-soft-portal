# Billing provider abstraction (Module 13)

```text
Alpha OS Billing Domain
        ↓
Billing Services       (src/server/services/*)
        ↓
Provider Abstraction   (src/lib/billing/provider/interface.ts, types.ts)
        ↓
Stripe Provider        (src/lib/billing/provider/stripe/*)
        ↓
Stripe API
```

Business logic never depends on Stripe-specific objects (spec §15/§16).
`src/lib/billing/provider/interface.ts`'s `BillingProviderAdapter` is
the ONE boundary a service is allowed to call through — every method's
input/output is expressed purely in Alpha OS domain terms (internal
ids, minor-unit amounts, ISO currency codes; see `types.ts`).
`stripe/provider.ts` is the only file in the codebase that imports the
`stripe` package and constructs a real Stripe API call; nothing else
does, including the webhook processor (which reads a `Stripe.Event`'s
own already-parsed fields, but performs no outbound Stripe API calls of
its own except one narrow, documented exception below).

## Adding a second provider

Write a new class implementing `BillingProviderAdapter` (e.g.
`src/lib/billing/provider/paddle/provider.ts`), map its own webhook
event shape into the same reconciliation calls
`billing-webhook-service.ts` already makes, and add its enum value to
`BillingProvider` (schema.prisma) plus a migration. No service function,
no repository, and no UI component needs to change — every one of them
already treats `provider` as data, never a hardcoded assumption.

## What Alpha OS never does with Stripe

- **Never stores raw card data** (spec §12/§38) — Checkout Sessions and
  the Billing Portal are entirely Stripe-hosted; Alpha OS never
  collects a PAN/CVV in its own request path at all, so there's no
  "sensitive data" to accidentally persist.
- **Never uses Stripe.js/Elements client-side.** Every provider
  interaction is a server-created session (Checkout, Billing Portal)
  whose URL the browser is redirected to — there is no publishable key
  anywhere in this codebase, and no `NEXT_PUBLIC_STRIPE_*` variable
  exists (spec §16: "the browser may receive safe publishable
  configuration only where genuinely required" — this module found it
  was never actually required).
- **Never treats a browser redirect as proof of payment** (spec §44) —
  `startCheckoutForPlanPrice()`'s success/cancel URLs are purely
  informational for the UI; the webhook is what actually changes
  subscription/invoice/payment state. See `billing-webhooks.md`.

## Environment separation (spec §52)

`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — server-only
(`config/environment.ts`), never exposed to the browser. Use TEST-mode
keys (`sk_test_...`, a test-mode webhook endpoint's `whsec_...`) in
every non-production environment — `isStripeLiveMode`
(`config/environment.ts`) exists specifically so a future
observability/startup check can make an accidental live key in a
non-production environment loud rather than silent, per spec's own
"configuration should make environment mistakes obvious." Nothing in
this module currently throws on that combination — a genuine, honest
gap, not a claim of enforcement that isn't there; a future module
wiring real environment-name detection into that check is a small,
well-contained addition.

## Status mapping (`stripe/mapper.ts`)

Stripe status strings are mapped into Alpha OS's own domain enums —
`mapStripeSubscriptionStatus()`/`mapStripeInvoiceStatus()`/
`mapStripePaymentIntentStatus()`/`mapStripeRefundStatus()` — never
passed through as raw strings, and every mapping function is TOTAL: an
unrecognized future Stripe value (the SDK's own `OtherString`
forward-compatibility escape hatch, which structurally prevents a
TypeScript exhaustiveness check from ever fully closing) falls back to
a safe, documented default rather than throwing mid-webhook-processing.
See `mapper.test.ts` for the full behavior table.

## Catalog sync (`Plan`/`PlanPrice`)

`PlanPrice.providerPriceId` is nullable — a price can be defined
internally (visible to platform staff in `/admin/plans`) before it
exists in Stripe at all. `startCheckoutForPlanPrice()` explicitly
rejects starting a checkout for a price with no `providerPriceId` (a
`SubscriptionChangeRejectedError`, never a raw Stripe "price not found"
error) — a plan/price can be drafted and reviewed internally without
risk of a customer reaching a broken checkout.

## One narrow exception to "the webhook processor makes no outbound calls"

`payment_intent.succeeded`/`.payment_failed` handling makes ONE
best-effort follow-up call — `stripe.charges.retrieve()` — ONLY when
`paymentIntent.latest_charge` arrives as a bare string id (not expanded
in the webhook payload), to recover the safe, already-tokenized
payment-method display fields (`paymentMethodType`/`Brand`/`Last4`).
Wrapped in its own try/catch: a failed lookup logs a warning and
continues with those fields left `null` — it never fails the whole
webhook over a missing display convenience.
