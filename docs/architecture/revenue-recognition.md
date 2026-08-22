# Revenue recognition (Module 16)

How much of Alpha OS's billed subscription revenue has actually been
EARNED, as of a given date — as distinct from what was billed
(Module 15's `Billed`) or what was collected in cash (Module 15's
`Collected`). See `billing-intelligence.md` for how Module 15 and 16
fit together, and `revenue-metrics.md` for Module 15's own metric
definitions this module deliberately doesn't duplicate.

## The method: ratable (straight-line) recognition

For a SaaS subscription's single performance obligation delivered
evenly over time, this is the standard treatment — the same pattern
virtually every subscription-billing platform uses for its own
recurring-revenue lines, and a real, honest, auditable ASC 606 / IFRS
15-aligned calculation.

**Formula** (`lib/billing/recognition/schedule.ts`'s `recognizedAsOf()`):
a line item's `amount` (its `InvoiceLineItem.total` — already net of
discount, tax-EXCLUDED) is recognized in exact proportion to how much
of `[servicePeriodStart, servicePeriodEnd)` has elapsed by `asOf`:

```text
recognized = amount × (asOf - periodStart) / (periodEnd - periodStart)
```

bounded to `[0, amount]`. Computed with `BigInt` for the multiplication
deliberately — a naive `Number` multiplication can exceed
`Number.MAX_SAFE_INTEGER` for a large invoice over a long period; see
the function's own doc comment.

**A zero-length period** (`periodStart === periodEnd`) is Stripe's own
representation of a ONE-TIME charge — not a special case in the
formula: it's recognized in full, exactly at `periodStart`, the
accounting-correct treatment for a true point-in-time obligation.

## Where the period comes from

`InvoiceLineItem.servicePeriodStart/End` — real Stripe data
(`line.period.start/end`, ALWAYS present on the real provider payload),
captured by `billing-webhook-service.ts` since this module (previously
discarded entirely — see `billing-webhooks.md`'s own Module 16
addendum). Stripe documents `period.end` as "inclusive"; in practice,
for a genuine subscription line, Stripe already sets it to exactly the
instant the NEXT period begins, so this module treats it as the
EXCLUSIVE boundary of a half-open range directly — the same
`[start, end)` convention `lib/billing/reporting/period.ts` already
established, with no adjustment needed.

## Basis: BILLED, not cash, not a forecast

A line is recognized ratably regardless of whether its invoice has
actually been PAID yet — the same "billed vs. collected are different
things" discipline `revenue-metrics.md` already established. Whether an
invoice was ever paid is a Module 15 concern (AR aging, financial
health); this module answers "of what we billed, how much has been
EARNED."

**Included invoice statuses**: `PAID`, `OPEN` only — real, finalized
billed obligations. `DRAFT` was never issued (not yet a real
obligation); `VOID`/`UNCOLLECTIBLE` were withdrawn or given up on
(neither belongs in a report of revenue actually earned). Same
exclusion reasoning `revenue-metrics.md`'s own AR aging section already
establishes.

## The two reports

### Deferred revenue balance

**What it means**: a point-in-time LIABILITY figure — how much billed
revenue has not yet been earned, as of right now.

**Query shape**: only line items with `servicePeriodEnd > asOf` are
fetched at all (`invoiceRepository.listLineItemsWithDeferredBalance()`)
— a line whose period has already fully elapsed contributes exactly `0`
to any deferred figure, so excluding it changes nothing about the
report while keeping the query real-time-safe at scale (never an
unbounded "every invoice line item ever" scan). This is a deliberate,
domain-driven performance bound, not an arbitrary cap.

**What it does NOT report**: a lifetime-cumulative "total revenue ever
recognized" figure — that would require an unbounded historical scan
and isn't what deferred-revenue reporting is for anyway (a balance
sheet liability, not an income-statement cumulative total).

### Recognition trend

**What it means**: how much revenue was recognized DURING each bucket
of a period (e.g., "how much did we earn in March"), reusing Module
15's own `FinancialPeriod`/`splitIntoBuckets()` — the identical bucketed
trend-chart pattern `billing-trends-service.ts` already established,
never a parallel implementation.

**Query shape**: each bucket independently fetches only the line items
whose service period actually OVERLAPS it
(`invoiceRepository.listLineItemsOverlappingPeriod()`), computed via
`recognizedInPeriod(line, bucket) = recognizedAsOf(bucket.end) - recognizedAsOf(bucket.start)`.

**Known limitation, honestly documented**: this is a TRUE point-in-time
calculation over REAL captured periods — unlike Module 15's own MRR
trend (which reconstructs history from currently-alive subscriptions'
CURRENT pricing, a documented approximation), the recognition trend
does not need that approximation at all, because `servicePeriodStart/End`
is real, immutable, per-invoice data captured at the moment the
invoice was created — not reconstructed after the fact.

## Why this is platform-only, not organization-facing

Unlike Module 15's MRR/aging (where a customer legitimately wants to
see their OWN outstanding balance), deferred revenue and recognition
timing are internal financial-reporting concerns for the PLATFORM
OPERATOR (Alpha Page Rankers' own books) — an individual customer
organization has no legitimate need to see "how much of your
subscription payment has Alpha Page Rankers recognized as revenue for
its own accounting purposes." A deliberate, documented scope decision
(`billing.compliance.read` is PLATFORM-scope only — see
`billing-reporting-security.md` "Permission set"), not an oversight.

## What this does NOT claim to be

- **Not a GAAP-certified accounting system.** No revenue-recognition
  schedule journal, no accrual/deferred-revenue GL account, no audit
  opinion. A real, correct calculation of one specific thing — how much
  of a ratably-delivered subscription's billed value has been earned —
  useful as an input to real accounting, not a replacement for it.
- **Not a multi-element-arrangement allocator.** This platform's
  billing model is single-performance-obligation subscriptions; a more
  complex revenue arrangement (bundled hardware + service, milestone-
  based delivery, etc.) is out of scope entirely.
- **Not a forecast.** Every figure is computed from ALREADY-BILLED,
  real invoice line items — nothing here projects future revenue.

## Known limitations

- **No backfill.** Line items created before this module's migration
  (`20260822173047_revenue_recognition_and_tax_detail`) have
  `servicePeriodStart/End = null` and are excluded entirely from every
  recognition report — that period data was never captured and cannot
  be honestly reconstructed after the fact.
- **A non-subscription one-time InvoiceItem with no real Stripe period**
  (a genuinely malformed or extremely old provider payload) is treated
  the same as a zero-length period — recognized in full at
  `periodStart` — a defensive fallback, not expected in practice given
  Stripe always includes `period` on every line.
