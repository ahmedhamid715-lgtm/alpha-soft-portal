# Billing webhooks (Module 13)

`POST /api/webhooks/stripe` (`src/app/api/webhooks/stripe/route.ts`) —
the ONLY entrypoint through which an external Stripe event can change
Alpha OS billing state (spec §17/§44). This is one of the most
important parts of this module: everything downstream trusts what
arrives here completely, so everything upstream of the trust boundary
has to be airtight.

## User action vs. provider event (spec §44)

```text
User action:
  "Change my plan" → requirePermission() → subscription-service.ts →
  stripeBillingProvider (creates a Checkout Session, records INTENT
  only — see billing-provider.md)

Provider event:
  "Subscription changed" → signed webhook → billing-webhook-service.ts
  → reconciliation → audit → notification
```

A browser redirect back from Checkout is never treated as proof of
anything (spec §44) — `subscription-service.ts`'s mutating functions
never write `Subscription.status`/`currentPeriodEnd`/etc. at all; only
`billing-webhook-service.ts` does. This is the concrete meaning of
spec §21's "Stripe owns provider subscription state; Alpha OS's
webhook synchronization reconciles it in."

## Signature verification (spec §17/§20)

`lib/billing/provider/stripe/webhook.ts`'s `verifyStripeWebhookSignature()`
— `stripe.webhooks.constructEventAsync(rawBody, signatureHeader,
STRIPE_WEBHOOK_SECRET)`, checked against the RAW request body
(`request.text()`, never `request.json()` — the route handler's own
comment explains why: re-serializing a parsed JSON object would never
byte-for-byte match what Stripe actually signed). A missing/invalid
signature throws before a single field of the body is trusted; an
unconfigured `STRIPE_WEBHOOK_SECRET` fails closed (never "trust the
request" as a fallback), even outside production.

Status codes ARE the retry contract (spec §49): a `ValidationError`
(bad/missing signature) maps to 400 — Stripe does not retry a 4xx,
correctly, since retrying a malformed/forged request would never
succeed. Any other thrown error (a genuine processing failure inside
`processStripeWebhookEvent()`) maps to 500 via the existing
`toAppError()`/`apiError()` architecture (Module 01, unchanged) — Stripe
retries a 5xx automatically, with its own exponential backoff over
several days. This IS this module's retry mechanism (spec §49's "do not
implement an in-process infinite retry loop. Use the future job
infrastructure boundary" — for webhook delivery specifically, Stripe's
own retry queue already is that boundary).

## Idempotency (spec §18)

`BillingWebhookEvent` — `UNIQUE(provider, providerEventId)` is the real
guarantee, a database constraint, not merely an application-level
pre-check. `billingWebhookEventRepository.tryInsert()` attempts the
insert; a `P2002` (unique violation) returns `null` rather than
throwing, and `processStripeWebhookEvent()` treats that as `{ outcome:
"duplicate" }` — a safe no-op, never a second processing pass. Proven
under REAL concurrent delivery (two simultaneous calls with the
identical `event.id`), not just reasoned about — see
`billing-webhook-service.test.ts`'s dedicated concurrency test: exactly
one delivery ever processes, the other is a duplicate, and the
`billing_webhook_events` table ends with exactly one row for that
event, regardless of which delivery "won" the race.

## Out-of-order events (spec §50)

Stripe does not guarantee webhook delivery order. `Subscription.
providerEventTimestamp` (a `DateTime`, from `event.created`, the Unix
timestamp Stripe itself assigns) is the guard: a newly-arrived
`customer.subscription.*` event with an EARLIER `event.created` than
the value already stored on the row is ignored — its own
`BillingWebhookEvent` record is still written and marked `processed`
(idempotency bookkeeping succeeded), but the reconciliation write is
skipped, so a stale event can never overwrite a newer one. Proven with
a real regression test: a newer ACTIVE event applied first, then a
deliberately-older PAST_DUE event delivered second — the subscription's
final status stays ACTIVE.

Invoice reconciliation doesn't need the same guard: `invoice.created`
only ever WRITES once (checked via `findByProviderInvoiceId` — a
second `invoice.created` for the same Stripe invoice id is a no-op, not
a duplicate write), and `invoice.paid`/`invoice.payment_failed` only
update status/amounts on an ALREADY-CREATED invoice — there is no
"apply an older amount over a newer one" scenario within this module's
own event set, since Stripe's own invoice lifecycle is strictly
one-directional (draft → open → paid/void/uncollectible) and this
module doesn't attempt to model a reversal.

## Event mapping — what's implemented, what's intentionally not

| Event | Handled | Effect |
|---|---|---|
| `customer.subscription.created`/`.updated`/`.deleted` | Yes | Upserts `Subscription` (+ new `SubscriptionItem`s), out-of-order-guarded, audited, `billing.subscription.created`/`.updated` emitted. |
| `invoice.created` | Yes | Creates `Invoice` + `InvoiceLineItem`s (the ONE point line items are ever written — immutable after). |
| `invoice.finalized` | Yes | Status/amount update only — never re-writes line items. |
| `invoice.paid` | Yes | Status/amount update + best-effort `Payment` linkage (see below); notifies `billing.payment.succeeded`. |
| `invoice.payment_failed` | Yes | Status/amount update; notifies `billing.payment.failed`. |
| `payment_intent.succeeded`/`.payment_failed` | Yes | Find-or-create `Payment` — the non-invoice (one-time-charge) path, and the safety net for a `Payment` `invoice.paid` couldn't link. |
| `charge.refunded` | Yes | Reconciles a `Refund` issued directly in the Stripe dashboard (not through `issueRefund()`), so Alpha OS's own refund history stays complete regardless of where a refund originated. |
| `customer.created`/`.updated` | Intentionally ignored | Alpha OS creates the customer itself (`billing-account-service.ts`) and never needs to react to Stripe's own copy of that event. |
| `checkout.session.completed` | Intentionally ignored | Superseded by `customer.subscription.created`/`.updated` — the resulting subscription carries everything this module needs; a separate handler for the checkout session itself would just be a second, redundant path to the same state. |
| `invoice.updated` | Intentionally ignored | A generic housekeeping event with no distinct Alpha OS domain effect beyond what `.finalized`/`.paid`/`.payment_failed` already cover. |
| Anything else | Recorded (idempotency bookkeeping), marked `IGNORED`, logged once | A genuinely unrecognized event type is never silently dropped without a trace — see "Failure handling" below. |

Deferred, evaluated, not built this module (spec's own explicit "future
functionality should be documented... not prematurely implemented"):
usage-based billing ingestion, a coupon/promotion engine beyond
`InvoiceLineItem`'s own discount fields, automated dunning beyond
Stripe's own default retry schedule, multi-provider failover.

## Invoice → Payment linkage — a documented best-effort join

Stripe's current API version moved `payment_intent`/`charge` off the
`Invoice` object itself onto a separate `payments` sub-collection
(`InvoicePayment`), not reliably present on a webhook's own event
payload without an additional expand. Rather than making an extra
Stripe API call on every `invoice.paid` (or depending on an
under-documented, version-fragile field), this module recovers the
PaymentIntent id from `Invoice.confirmation_secret.client_secret`
(Stripe's own stable `{intentId}_secret_{...}` convention) and performs
a find-or-create `Payment` linkage. If `confirmation_secret` is absent
(older API shapes, or `collection_method: "send_invoice"` invoices),
the `Invoice` itself is still fully and correctly recorded — only the
`Payment.invoiceId` linkage is skipped, a documented, honest limitation
rather than a silent guess.

## Failure handling — unresolvable events (spec §49)

An event referencing a Stripe customer id with no matching
`BillingAccount` (`resolveBillingAccountByCustomerId()` returns `null`)
throws rather than being silently dropped — the `BillingWebhookEvent`
row is marked `FAILED` with a specific, safe error message
(`"No BillingAccount found for Stripe customer {id}"`), visible in the
platform observability list (`billing-platform-service.ts`'s
`listRecentWebhookEventsForPlatform()`) for manual reconciliation.
Stripe's own automatic retries give this a real chance to resolve
itself if the gap is transient (e.g. a genuine ordering race between
customer creation and a subscription event); a permanently orphaned
event (e.g. a subscription created directly in the Stripe dashboard for
an organization with no Alpha OS billing account at all) simply stays
`FAILED` until a human investigates — an honest terminal state, not a
crash and not a silent no-op.

## Why `billing_webhook_events` has no RLS

Platform infrastructure, not tenant data (spec §31's own explicit
carve-out: "webhook-event records may require a different platform/
infrastructure classification"). Two structural reasons, not just a
convenience:

1. **No tenant context exists at the point of receipt.** The webhook
   route handler has no user session, no cookie, no logged-in identity
   — there is nothing to call `withTenantContext()` with. Many events
   (`customer.created`, and in principle any event Alpha OS receives
   before it can resolve which `BillingAccount` a Stripe object belongs
   to) have no organization to attribute at insert time at all.
2. **The real access boundary is a permission, not a row filter.**
   `billing.readPlatform` (PLATFORM-scope) is what actually gates who
   can see this table's contents (`listRecentWebhookEventsForPlatform()`)
   — an RLS policy keyed on "the current tenant context" has nothing
   coherent to filter by here, since the table has no `organizationId`
   column to filter with in the first place.

`UNIQUE(provider, providerEventId)` is the idempotency guarantee (see
above) — that constraint, not RLS, is what protects this table's real
integrity concern.

## Observability (spec §47)

Every webhook processing attempt logs its own `eventId`/`eventType`/
outcome (`billing.webhook.process`), and a genuine processing failure
logs the same plus the safe error message (`billing.webhook.process_failed`)
— never a raw Stripe payload, never a secret. `logger.child({requestId,
...})` (Module 01's existing request-id-scoped logging, via
`createRouteHandler`) carries the request id through automatically, the
same as every other route handler in this codebase.

A genuine processing failure ALSO best-effort audits
`billing.webhook.failed` (Module 14) — wrapped in its own `.catch()`
inside `processStripeWebhookEvent()`'s own catch block, placed before
the re-throw, so a failure to WRITE the audit row (e.g. the database
itself is unreachable, the same failure that likely caused the webhook
processing to fail in the first place) never masks or replaces the
original error the route handler needs to return the correct status
code for. This is deliberately NOT a duplicate of the specific domain
action each SUCCESSFUL webhook already produces (`billing.subscription.
updated`, `billing.payment.succeeded`, etc.) — those remain the audit
trail for "what changed"; `billing.webhook.failed` exists ONLY for "an
event failed to process at all," a case those other actions structurally
can't represent since no domain mutation happened. `/admin/billing/
webhooks` (Module 14, `billing.readPlatform`) is the operator-facing view
of this same `BillingWebhookEvent` list `listRecentWebhookEventsForPlatform()`
already exposed at the service layer since Module 13 — this module adds
the missing UI, not new backend surface.

## Module 14 additions

- **`customer.subscription.trial_will_end`** — Stripe's own advance-
  warning event (fires ~3 days before a trial ends, per Stripe's default
  configuration). Handled (`handleTrialWillEnd()`), but deliberately
  WRITES NOTHING — it only emits `billing.trial.ending` for
  `lib/notifications/subscribers.ts` to turn into a customer-facing
  notification. There is no local `Subscription` field this event would
  even change (`trialEnd` is already known from the original
  `customer.subscription.created`/`.updated` event); its only purpose is
  the advance-warning notification itself.
- **Trial ended → converted vs. expired** — Module 14 doesn't add a new
  webhook handler for this distinction at all. It's derived from the
  EXISTING `customer.subscription.updated` handler's own before/after
  comparison: when the previous status was `TRIALING` and the new status
  is `ACTIVE`, that's a conversion (`billing.trial.ended`, positive
  framing); when it becomes anything else (`CANCELED`,
  `INCOMPLETE_EXPIRED`), that's an expiration. One handler, one
  comparison, not two competing sources of truth for the same
  transition.
