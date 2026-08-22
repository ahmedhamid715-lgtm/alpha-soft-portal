# Subscription lifecycle (Module 14)

The state machine that governs every subscription mutation — the one
chokepoint `cancelSubscription()`/`resumeSubscription()`/
`changeSubscriptionPlan()` all call BEFORE touching the provider or the
database. See `lib/billing/subscription-state-machine.ts`.

## Why a display state, not a ninth status

`SubscriptionStatus` (the Prisma enum, mirroring Stripe's own) has eight
values: `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`,
`INCOMPLETE`, `INCOMPLETE_EXPIRED`, `UNPAID`. A subscription scheduled to
cancel at period end is still, structurally, `ACTIVE` — Stripe itself
doesn't model "canceling" as a distinct status, only as `cancel_at_
period_end: true` layered on top of whatever status the subscription
otherwise has. Inventing a ninth enum value here would mean Alpha OS's
own schema diverging from the provider's actual model for no real
benefit — instead, `describeLifecycleState(status, cancelAtPeriodEnd)`
computes a `LifecycleState` (the eight statuses, plus
`ACTIVE_CANCEL_AT_PERIOD_END` as a DERIVED display value) purely for
UI/business-logic legibility. Nothing is ever persisted in this shape;
`Subscription.status` in the database is always one of the real eight.

## The transition table

`ALLOWED_ACTIONS_FROM_STATUS: Record<SubscriptionStatus, ReadonlySet<SubscriptionAction>>`
— the full, explicit table, not a set of ad-hoc `if` checks scattered
across service functions:

| From status | Allowed actions |
|---|---|
| `TRIALING` | `ACTIVATE`, `CHANGE_PLAN`, `SCHEDULE_CANCELLATION`, `CANCEL_IMMEDIATELY`, `MARK_PAST_DUE` |
| `ACTIVE` | `CHANGE_PLAN`, `SCHEDULE_CANCELLATION`, `UNDO_SCHEDULED_CANCELLATION`*, `CANCEL_IMMEDIATELY`, `MARK_PAST_DUE` |
| `PAST_DUE` | `CHANGE_PLAN`, `CANCEL_IMMEDIATELY`, `MARK_UNPAID`, `ACTIVATE` |
| `PAUSED` | `ACTIVATE`, `CANCEL_IMMEDIATELY` |
| `UNPAID` | `CANCEL_IMMEDIATELY`, `ACTIVATE` |
| `INCOMPLETE` | `ACTIVATE`, `MARK_INCOMPLETE_EXPIRED`, `CANCEL_IMMEDIATELY` |
| `CANCELED` | *(none — terminal)* |
| `INCOMPLETE_EXPIRED` | *(none — terminal)* |

\* `UNDO_SCHEDULED_CANCELLATION` is only actually valid when
`cancelAtPeriodEnd` is already `true` — `validateSubscriptionTransition()`
takes BOTH `status` AND `cancelAtPeriodEnd` as input specifically so this
one action can be gated on the flag, not just the status. Resuming a
subscription that was never scheduled to cancel is rejected with a clear
domain error, not silently treated as a no-op. Note `PAST_DUE` does NOT
allow `SCHEDULE_CANCELLATION` — a past-due subscription is already
heading toward involuntary churn via Stripe's own dunning; Alpha OS
offers immediate cancellation from that state, not a second, redundant
"cancel later" path.

**Not every action in this table is reachable through a real service
call today.** Only four of the nine `SubscriptionAction` values are ever
actually passed to `validateSubscriptionTransition()` by a real function:
`SCHEDULE_CANCELLATION`/`CANCEL_IMMEDIATELY` (`cancelSubscription()`),
`UNDO_SCHEDULED_CANCELLATION` (`resumeSubscription()`), and `CHANGE_PLAN`
(`changeSubscriptionPlan()`/`previewPlanChange()`). `ACTIVATE`,
`MARK_PAST_DUE`, `MARK_UNPAID`, `MARK_INCOMPLETE_EXPIRED`, and
`START_TRIAL` exist in the table because they're real transitions this
domain has — they just happen via `billing-webhook-service.ts` directly
writing `applyProviderState()` from Stripe's own event, which is
Stripe's ground truth by definition and doesn't need Alpha OS's own gate
to re-validate it. The table still documents them for completeness (spec
§3's own request: "explicit transition rules... for every state"), and
remains the single source of truth for which states CAN reach which
others, even for the transitions no user-initiated code path currently
exercises.

**`CANCELED` → `ACTIVE` is explicitly, permanently forbidden** — the
literal spec requirement this table encodes structurally rather than as
a comment: reactivating a canceled subscription is only ever a genuinely
NEW subscription (a new Stripe object, a new `Subscription` row via a
fresh Checkout Session), never a status flip on the old one. There is no
action in this table that transitions FROM `CANCELED` at all.

## `validateSubscriptionTransition()` — the mandatory chokepoint

```ts
export function validateSubscriptionTransition(
  status: SubscriptionStatus,
  cancelAtPeriodEnd: boolean,
  action: SubscriptionAction,
): void // throws SubscriptionChangeRejectedError, never returns a boolean
```

Every mutating service function (`cancelSubscription()`,
`resumeSubscription()`, `changeSubscriptionPlan()`) calls this INSIDE the
same locked transaction that reads the current row, immediately after
acquiring the lock and BEFORE calling the provider — never trusting
whatever state the UI last rendered (spec §4: "always re-read server
state"). A second concurrent request that raced the first one in always
sees the LOCK-holder's own already-applied result, not the stale state
both requests originally read, which is what makes the concurrency tests
in `subscription-concurrency.test.ts` pass deterministically rather than
by luck.

`canPerformAction(status, cancelAtPeriodEnd, action): boolean` is the
non-throwing sibling — UI-facing ONLY (which buttons to render), never
the real authorization/validation boundary. A UI bug that renders a
button it shouldn't still can't produce an invalid transition, because
the server-side function underneath still calls
`validateSubscriptionTransition()` independently.

## Who writes what — the same rule as Module 13, restated

Every function in this list calls the PROVIDER and records the caller's
INTENT only; none of them write `Subscription.status`, `currentPeriodEnd`,
or `SubscriptionItem` rows. Only `billing-webhook-service.ts`, reconciling
a real Stripe event, ever writes those fields:

- `cancelSubscription()` — the ONE narrow, deliberate exception:
  `cancelAtPeriodEnd` itself IS set optimistically, locally, immediately.
  This is safe specifically because it mirrors EXACTLY what was just
  requested (not a guess about provider-side outcome) — the caller asked
  to schedule a cancellation, and that flag being true is definitionally
  correct regardless of what the webhook later confirms. Immediate
  cancellation does NOT set this flag (nothing safe to set optimistically
  there — the real status change only exists once Stripe actually
  processes it).
- `resumeSubscription()` — same optimistic flag, flipped back to `false`
  for the identical reason.
- `changeSubscriptionPlan()` — writes NOTHING locally. The new
  `SubscriptionItem`/price only becomes visible once the webhook
  reconciles the real Stripe subscription update. The event this
  function emits (`billing.plan.change_requested`) is named to reflect
  that honestly — a request, not a confirmation.

## Health, derived not duplicated

`lib/billing/health.ts`'s `computeBillingHealth(billingAccountStatus,
subscription)` is a pure function, never a cached/denormalized column —
`healthy | trial | payment_due | payment_failed | past_due | suspended |
canceled`, computed fresh on every read from the two pieces of state that
already exist (`BillingAccount.status`, `Subscription.status`/
`cancelAtPeriodEnd`). Nothing writes to a `BillingAccount.health` column
because no such column exists; adding one would create exactly the kind
of "two sources of truth that can drift" this whole module's own
Stripe-vs-Alpha-OS reconciliation discipline exists to avoid.
