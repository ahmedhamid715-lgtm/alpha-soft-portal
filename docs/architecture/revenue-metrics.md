# Revenue metrics — exact definitions (Module 15)

Every figure this module surfaces, defined precisely: formula, source of
truth, currency behavior, date semantics, and what it deliberately does
NOT claim to measure. See `billing-intelligence.md` for the shared
period/currency/health-model conventions this document assumes, and
`financial-controls.md` for anomaly detection rather than metrics.

## MRR (Monthly Recurring Revenue)

**What it means:** if every currently-INCLUDED subscription renewed
today at its current price, what would the platform bill next month.

**Formula:** for each subscription with `status` in `MRR_INCLUDED_STATUSES`,
sum each `SubscriptionItem`'s monthly-equivalent value
(`monthlyEquivalent()`, `mrr.ts`):

- `MONTH` interval → `unitAmount * quantity`
- `YEAR` interval → `round(unitAmount / 12) * quantity` (rounded PER
  ITEM before multiplying by quantity, not after summing — so a second
  identical item always changes MRR by exactly double the first item's
  own contribution)

Grouped and summed BY CURRENCY via `addMoney()` (throws on mismatch —
currencies are never blended).

**Included statuses**, with reasoning:

| Status | Included? | Why |
|---|---|---|
| `ACTIVE` | Yes | The baseline committed-revenue state. |
| `PAST_DUE` | Yes | Still contractually intact — mid-retry, not yet given up on (unlike `UNPAID`). |
| `TRIALING` | No | No committed recurring revenue yet — mainstream SaaS convention (ChartMogul/Baremetrics/ProfitWell all exclude trials); can still convert to $0 with no charge. |
| `PAUSED` | No | Stripe's own semantics: no billing occurs during a pause. |
| `CANCELED` / `INCOMPLETE` / `INCOMPLETE_EXPIRED` | No | No longer, or never became, a live commercial relationship. |
| `UNPAID` | No | Stripe's terminal pre-cancellation state (retries exhausted) — surfaced instead via AR aging / financial health, deliberately kept out of a number meant to represent healthy recurring commitment. |

**Credits:** never subtracted. MRR is a CONTRACTUAL measure — a
promotional/goodwill credit changes what's actually invoiced or
collected, not what the customer is contractually committed to pay
going forward.

**Discounts:** this platform's schema has no subscription-level or
plan-price-level discount/coupon concept. MRR is computed from
`PlanPrice.unitAmount` directly — the undiscounted catalog rate. A
documented limitation, not an oversight.

**Source of truth:** `Subscription` + `SubscriptionItem` + `PlanPrice`,
read live via `subscriptionRepository.listWithPricedItems()`
(`SubscriptionWithPricedItems`), tenant-scoped through
`withTenantContext()`.

**Date semantics:** a point-in-time snapshot (current MRR, right now) —
not itself a period-bounded query.

**Currency:** grouped by `PlanPrice.currency`, one row per currency.

## ARR (Annual Recurring Revenue)

**Formula:** `ARR = MRR × 12` (`computeArr()`), derived, never a stored
column.

**What it does NOT claim to be:** not a forecast (no growth/churn
assumption baked in), not a GAAP annual revenue figure — a simple
annualization of CURRENT recurring commitment.

## MRR movement (New / Expansion / Contraction / Churn / Reactivation)

**What it means:** how MRR changed during a period, broken down by
cause. See `movement.ts`'s own top comment for the full reasoning; this
is its summary.

| Type | Trigger | Source |
|---|---|---|
| **NEW** | `Subscription.createdAt` falls inside the period, AND the organization has no earlier subscription with `canceledAt` before this one's `createdAt` | `Subscription.createdAt`/`canceledAt` (real, immutable) |
| **REACTIVATION** | Same as NEW, but the organization DOES have an earlier, since-canceled subscription | Same |
| **CHURN** | `Subscription.canceledAt` falls inside the period, `status = CANCELED` | `Subscription.canceledAt`; MRR "lost" read from the subscription's own (never-deleted) `SubscriptionItem` rows as they stood at cancellation |
| **EXPANSION** | A `billing.plan.changed` audit event inside the period where the new plan price's monthly-equivalent value is HIGHER than the previous | `billing.plan.changed` audit event's `previousState.planPriceId`/`newState.planPriceId` |
| **CONTRACTION** | Same, but LOWER | Same |

A plan-price change with an EQUAL monthly-equivalent value (a lateral
move) produces no movement row at all — never a fabricated zero-delta
entry.

**No snapshot table:** there is no historical MRR snapshot table in
this platform. This is the ONE supported measurement method, built
entirely from real, already-existing, immutable records — see
`billing-intelligence.md` "No new database table" for why a snapshot
table was evaluated and rejected.

**Known limitation:** a plan change made by any means OTHER than
`changeSubscriptionPlan()` (e.g. edited directly in the Stripe
dashboard) produces no audit event and is invisible to movement
classification — the webhook-driven `SubscriptionItem` update still
happens correctly (current MRR stays accurate), just without a movement
explanation for HOW it changed. A quantity change bundled into the same
plan-change request as a price change is also not separately
attributed — the audit event only captures `planPriceId`, not quantity;
this module uses the subscription item's CURRENT quantity for both
sides of the comparison (exact for a pure price change, an
approximation otherwise).

**Net MRR change** = `newMrr + expansionMrr + contractionMrr + churnedMrr + reactivationMrr`
for the period, per currency (`summarizeMovements()`).

## Billed

**What it means:** the total of every non-draft invoice ISSUED during
the period — what was billed, regardless of whether it has been
collected yet.

**Source of truth:** `Invoice.subtotal`/`Invoice.total`, via
`invoiceRepository.sumBilledByCurrency()`.

## Collected

**What it means:** real cash that actually arrived — the sum of
SUCCEEDED `Payment` rows PAID during the period, regardless of which
invoice (if any) they're linked to.

**Source of truth:** `Payment` rows with `status = SUCCEEDED`, via
`paymentRepository.sumCollectedByCurrency()`.

## Refunded

**What it means:** cash given back — the sum of SUCCEEDED `Refund` rows
issued during the period.

**Source of truth:** `Refund` rows with `status = SUCCEEDED`, via
`refundRepository.listSucceededInPeriod()`.

## Net collected

**Formula:** `collected - refunded`, per currency present in EITHER.
An honest "net cash movement" figure — still not a GAAP net-revenue
figure (no accrual, no deferred-revenue recognition).

## Credits issued

**What it means:** promotional/goodwill credits issued during the
period — applied to a FUTURE invoice, not cash movement at all. Never
subtracted from MRR (see above) or from Collected (a credit is not a
refund).

**Source of truth:** `CreditLedgerEntry` rows with `type = CREDIT`, via
`creditLedgerRepository.sumIssuedByCurrency()`.

## AR aging (Accounts Receivable Aging)

**What counts as a receivable:** an `Invoice` with `status = "OPEN"`
AND `amountDue > 0`. A DRAFT invoice was never finalized (not yet a
real obligation); a PAID invoice has nothing outstanding; VOID/
UNCOLLECTIBLE are no longer expected to collect at all. A partially-paid
invoice is already correctly represented — `status` stays `OPEN` until
`amountDue` reaches zero, and the bucket amount is always `amountDue`
(the actual outstanding balance), never `total`.

**Buckets:** `current`, `1–30 days`, `31–60 days`, `61–90 days`,
`91–120 days`, `120+ days` (`AGING_BUCKETS`).

**Days overdue:** whole UTC calendar days between `Invoice.dueDate` and
an explicit `asOf` parameter (never `Date.now()` computed inside the
pure function — deterministic and unit-testable). An invoice with no
`dueDate` at all is bucketed `current` (nothing has actually come due).
UTC is used consistently for BOTH platform-wide and organization-scoped
views — see `billing-intelligence.md` "Date semantics."

**Source of truth:** `invoiceRepository.listOpenForAging()`, computed by
the pure `computeAgingReport()` (`aging.ts`).

## Customer financial health

**What it means:** how much financial risk a specific organization
represents to platform operations right now — a TRANSPARENT,
deterministic classification (`HEALTHY`/`WATCH`/`AT_RISK`/`CRITICAL`),
never a black-box or AI-generated score. See `billing-intelligence.md`
"Two health models, on purpose" for how this differs from Module 14's
lifecycle-status label.

**Rule evaluation** (most-severe-first — the FIRST matching tier wins;
a CRITICAL account is never also described as merely AT_RISK):

| Tier | Any of | Reason string example |
|---|---|---|
| **CRITICAL** | Billing account `SUSPENDED`; subscription `UNPAID`; ≥60 days overdue on any open invoice | `"Invoice INV-2026-000042 is 61 days overdue."` |
| **AT_RISK** | ≥30 days overdue; ≥2 failed payments in the trailing 30 days; subscription `PAST_DUE` | `"2 payments failed in the last 30 days."` |
| **WATCH** | `cancelAtPeriodEnd`; ≥1 day overdue; exactly 1 failed payment in the trailing 30 days | `"Subscription is scheduled to cancel at the end of the current period."` |
| **HEALTHY** | None of the above | `"No overdue invoices, no recent payment failures, no scheduled cancellation."` |

Every classification carries the exact reason(s) that produced it —
built as plain-English sentences from the real signal values (a
specific invoice number, a specific day count, a specific failure
count), never a bare label.

**Source of truth:** `BillingAccount.status`, `Subscription.status`/
`cancelAtPeriodEnd`, the AR aging engine's own worst-overdue figure for
the organization, and a COUNT of `Payment` rows with `status = FAILED`
in a fixed, bounded trailing 30-day window (never an unbounded lifetime
count).

## Billing trends

**What it means:** MRR (and revenue) over time, bucketed into equal-
length time slices across a period (`splitIntoBuckets()`).

**Known limitation, honestly documented:** each historical bucket is
reconstructed from CURRENTLY-ALIVE subscriptions' CURRENT pricing —
this is NOT a true point-in-time snapshot. A subscription that has
since changed plans contributes its CURRENT price to every historical
bucket it existed in, not what it actually billed at that point in
time. Building a true historical reconstruction would require either a
persisted MRR history (rejected — see "No new database table" in
`billing-intelligence.md`) or replaying every plan-change audit event
against every bucket boundary (a materially more complex feature this
module did not build, and documents rather than fakes). The accessible
data-table shown alongside every trend chart makes this same
CURRENT-pricing-projected-backward data available in text form — it is
not hiding anything the chart doesn't already show.

## Subscription status counts

**What it means:** a raw count of subscriptions per `SubscriptionStatus`
value, platform-wide — not itself a derived metric, just a direct
tally, shown for context alongside MRR (e.g. "how many of our ACTIVE
subscriptions" next to "how much MRR do they represent").
