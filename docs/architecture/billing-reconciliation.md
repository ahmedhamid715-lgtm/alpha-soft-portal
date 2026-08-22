# Billing reconciliation (Module 14)

The foundation for DETECTING divergence between Alpha OS's own billing
records and Stripe's — not an automated repair system. See
`billing-webhooks.md` for how normal, healthy synchronization already
works; this document is specifically about the case where it hasn't.

## Why detection, not repair

`billing-webhook-service.ts` is still the ONLY writer of `Subscription`
state — unchanged by this module. `reconcileOrganizationBilling()`
(`billing-reconciliation-service.ts`) reads BOTH sides — the local
`Subscription` row and a live `stripeBillingProvider.getSubscription()`
call — and reports a diff. It is deliberately, structurally incapable of
writing anything: no repository write call exists anywhere in this
function, proven not just by code review but by a real regression test
that asserts the local row is byte-identical before and after running
reconciliation, even when a genuine divergence WAS found
(`billing-reconciliation-service.test.ts`).

Automatic repair was evaluated and explicitly not built. The reasoning:
a divergence between Alpha OS and Stripe is, by construction, a sign
something ALREADY went wrong in a way this module's own extensive
concurrency/idempotency/ordering guarantees didn't anticipate (a missed
webhook delivery beyond Stripe's own retry window, a manual edit made
directly in the Stripe dashboard, a genuine bug). Auto-repairing that
silently — picking one side and overwriting the other — risks
compounding a real problem with a wrong guess, with no human in the
loop to catch it. Spec §39's own framing ("if automatic repair is
implemented, require explicit safe rules") is a real bar this module
chose not to try to clear yet; the honest, correct scope for THIS module
is detection, surfaced clearly enough that a human decides what to do
next.

## What's compared

Three fields, chosen because they're exactly what a webhook gap would
leave stale — not an exhaustive field-by-field diff of every Stripe
subscription attribute Alpha OS doesn't even model:

| Field | Local source | Remote source |
|---|---|---|
| `status` | `Subscription.status` | `getSubscription()`'s already-mapped `SubscriptionStatus` (via `mapStripeSubscriptionStatus()` — never a raw Stripe status string, same provider-boundary discipline as everywhere else in this module) |
| `cancelAtPeriodEnd` | `Subscription.cancelAtPeriodEnd` | Stripe's own `cancel_at_period_end` |
| `currentPeriodEnd` | `Subscription.currentPeriodEnd` (a `DateTime`) | Stripe's own Unix-seconds field, converted for comparison |

## The three honest "nothing to compare" states

`OrganizationReconciliationResult` distinguishes these explicitly rather
than collapsing them into a single boolean, because each means something
different to whoever reads the report:

1. **`hasBillingAccount: false`** — the organization has never started
   billing at all. Not a divergence; there's nothing to have diverged.
2. **`hasBillingAccount: true, hasLocalSubscription: false`** — a
   billing account exists (e.g. from a prior canceled/expired attempt)
   but no current subscription. Also not a divergence — the provider is
   never even called in this case (proven: `getSubscription` mock call
   count asserted zero).
3. **`hasLocalSubscription: true, hasRemoteSubscription: false`** — THIS
   one IS a genuine, actionable divergence: Alpha OS has a subscription
   Stripe has no record of at all (`getSubscription()` returns `null`
   for a real `resource_missing` from Stripe, mapped honestly rather
   than treated as "no divergence"). Reported as a `status` divergence
   with `remote: "(not found)"`.

## Where this surfaces

`/admin/billing/organizations/[id]` — a "Run reconciliation check"
button (`billing.readPlatform`, same permission as the rest of that
page), calling the server action directly and rendering the result
inline: either a plain "no divergence found" confirmation, or the exact
field-by-field diff. Not a scheduled job, not a background cron — spec
§49's own "do not implement an in-process infinite retry loop" logic
extends here too: this codebase has no job-queue infrastructure to run a
periodic sweep against yet, and a human-triggered, on-demand check for a
specific organization is the honest scope for what this module actually
has to work with.

## What a future module would need to build automatic repair

Documented here so the boundary is explicit, not implied: a real repair
system would need (1) an explicit, narrow allowlist of SAFE auto-repair
rules (e.g. "if Stripe shows CANCELED and Alpha OS shows ACTIVE with no
webhook processed in N days, treat Stripe as ground truth" — one
direction, one condition, not a general "sync everything" rule), (2) an
audit trail distinct from a normal user-initiated mutation (spec's own
"who/what triggered this repair" concern), (3) very likely the job-queue
infrastructure this codebase doesn't have yet so repairs can run on a
schedule rather than only when a human happens to click the button. None
of that is built here — this module's own honest scope is "detect and
report," full stop.
