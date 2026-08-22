# Billing intelligence, revenue operations & financial controls (Module 15)

Module 15 turns Module 13's billing foundation and Module 14's
subscription-lifecycle operations into a REPORTING and DIAGNOSTIC layer
on top of them. It answers questions like "what's our MRR," "who's
behind on payments," and "does anything look inconsistent" — it never
becomes a second source of financial truth, and it never mutates a
financial record to make a report look right.

This document is the map. For the exact definition of any individual
number, see `revenue-metrics.md`. For the operational control center and
anomaly rules, see `financial-controls.md`. For the authorization/RLS/
export security model, see `billing-reporting-security.md`.

## What this module is built on

- **Module 13** (billing foundation) — `BillingAccount`, `Subscription`,
  `SubscriptionItem`, `Invoice`, `Payment`, `Refund`, `CreditLedgerEntry`,
  `Plan`/`PlanPrice`, `BillingWebhookEvent`. Every number in Module 15 is
  derived from these tables, read-only, through the tenant-context-aware
  repositories Module 13 already established.
- **Module 14** (subscription lifecycle & operations) — plan changes
  (`changeSubscriptionPlan()`, which records a `billing.plan.changed`
  audit event this module reuses as its MRR-movement source), refunds,
  credits, trial extension, reconciliation (`reconcileOrganizationBilling()`,
  reused as-is and extended with an audit call — see
  `billing-reconciliation.md`).
- **Module 08** (audit system) — the ONLY audit trail this module writes
  to. No second audit table, no parallel logging system.
- **Module 05** (authorization) — `requirePermission()`,
  `resolvePlatformContext()`/`resolveOrganizationContext()`, and three
  new PLATFORM-scope permission keys this module adds (see
  `billing-reporting-security.md`).
- **Module 02** (design system) — every new page reuses `AppShell`,
  `PageHeader`, `SectionHeader`, `MetricCard`, `StatusBadge`, `DataTable`/
  `Table`, and `AreaChart`. No parallel visual language.

## What's new

| Surface | Route | Permission |
|---|---|---|
| Financial dashboard | `/admin/billing` | `billing.analytics.read` |
| Billing organizations directory | `/admin/billing/organizations` | `billing.readPlatform` (moved here from `/admin/billing`, unchanged since Module 13) |
| Control center | `/admin/billing/controls` | `billing.controls.read` |
| Report exports | `/admin/billing/reports`, `/admin/billing/export/[type]` | `billing.reports.export` |
| Extended organization detail | `/admin/billing/organizations/[id]` (financial health/MRR/aging sections added to Module 13/14's existing page) | `billing.readPlatform` |
| Extended customer billing page | `/organizations/[id]/billing` (outstanding-balance + export sections added) | `billing.read` (org-scoped, unchanged) |
| Organization's own exports | `/organizations/[id]/billing/export/[type]` | `billing.read` (org-scoped) |

New service modules (`src/server/services/`): `mrr-service.ts`,
`revenue-reporting-service.ts`, `financial-health-service.ts`,
`billing-trends-service.ts`, `billing-diagnostics-service.ts`,
`billing-export-service.ts`. New pure domain logic
(`src/lib/billing/reporting/`): `period.ts`, `mrr.ts`, `movement.ts`,
`aging.ts`, `financial-health.ts`, `anomalies.ts`, `csv.ts`.

## No new database table

Every Module 15 number is computed on read, from existing Module 13/14
tables, inside the SAME `withTenantContext()` RLS boundary every other
tenant-scoped read in this codebase already uses. This was a deliberate
evaluation, not an oversight: a reporting snapshot table would be a
SECOND source of truth for a value that's already fully derivable from
authoritative records, and every one of this module's own metrics —
MRR, movement, aging, revenue, financial health, trends — is cheap
enough to compute from indexed queries at the data volumes this
platform actually has. If a future module's data volume ever makes
on-read computation too slow, the honest next step is a JUSTIFIED
snapshot/materialization layer with an explicit consistency model,
refresh strategy, and backfill plan — not something this module
speculatively builds "because it sounds enterprise" (spec's own explicit
instruction).

**No new migration exists for this module** — confirmed by
`npx prisma migrate status` showing no pending changes; the schema is
byte-identical to Module 14's.

## Two health models, on purpose

This module's `computeFinancialHealth()` (`financial-health.ts`) is
DELIBERATELY separate from, and never replaces, Module 14's
`computeBillingHealth()` (`lib/billing/health.ts`, still used unchanged
throughout the existing customer/admin billing UI):

- **`computeBillingHealth()`** (Module 14) — "what LIFECYCLE STAGE is
  this billing account in." A coarse ~7-value label driven directly by
  `BillingAccountStatus`/`SubscriptionStatus` alone.
- **`computeFinancialHealth()`** (Module 15) — "how much FINANCIAL RISK
  does this account represent to platform operations right now." A
  4-value classification (`HEALTHY`/`WATCH`/`AT_RISK`/`CRITICAL`)
  combining MULTIPLE signals (days overdue, consecutive payment
  failures, scheduled cancellation, suspension) the lifecycle label
  deliberately doesn't attempt to weigh against each other, with every
  classification exposing the exact plain-English reasons that produced
  it — never a bare label, never a numeric score.

They answer different questions and both remain in the UI where each
was already useful.

## Date semantics

One shared abstraction (`period.ts`'s `FinancialPeriod`) for every
report. Two rules, applied consistently everywhere:

1. **Half-open ranges** — `[start, end)`, inclusive start, exclusive
   end. A record belongs to a period iff `start <= record.date < end`.
2. **Timezone anchoring** — an ORGANIZATION-scoped report resolves named
   periods (`"current_month"`, etc.) against that organization's own
   `Organization.timezone`. A PLATFORM-WIDE report anchors to UTC —
   organizations span many timezones, so a platform aggregate has no
   single "local day" to be consistent about; UTC is the one instant
   every organization agrees on. AR aging (`daysOverdue()`) uses UTC
   whole-calendar-day arithmetic in BOTH views for the same reason — the
   same invoice is never bucketed differently depending on which view
   rendered it.

See `period.ts`'s own top comment for the full DST-safe timezone-offset
algorithm (`startOfDayUtc()`), and `tests/unit/lib/billing/reporting/period.test.ts`
for the non-UTC-timezone regression coverage that caught and fixed a
real 24-hour offset bug during this module's own development.

## Multi-currency

Every aggregate is grouped BY CURRENCY, never blended into one number.
`addMoney()` (the same currency-safe primitive used everywhere else in
this codebase) enforces this — it throws `CurrencyMismatchError` rather
than silently combining two currencies. A platform with both USD and
EUR customers gets two MRR rows, two revenue rows, two aging totals —
never one fabricated combined figure. Verified live during this
module's own testing: a seed-fixture currency bug (see "Known
limitations" below) was caught specifically because it produced an
unexpected third currency row in a live MRR export, not by looking
"reasonable" and passing silently.

## What this platform does NOT claim to be

Restated here because it governs every design decision in this module,
not just one metric (each individual metric's own doc in
`revenue-metrics.md` repeats the parts specific to it):

- **Not a GAAP accounting system.** No revenue recognition, no accrual
  accounting, no deferred-revenue schedule. MRR/ARR/BILLED/COLLECTED are
  all honestly-scoped operational metrics, not financial-statement
  figures.
- **Not a tax engine.** No tax calculation, no jurisdiction logic.
- **Not an FX engine.** No currency conversion anywhere — every figure
  stays in its original currency.
- **Not AI-powered.** No predictive churn scoring, no anomaly detection
  by machine learning, no black-box financial health score. Every
  classification and every anomaly rule is a fixed, documented,
  independently-testable deterministic function.
- **Not a data warehouse.** No ETL, no separate analytical store, no
  Redis/Kafka/ClickHouse. Every number is computed on read from the
  same authoritative Postgres tables Module 13/14 already write to,
  through the same RLS boundary every other tenant read uses.

## Known limitations (honest, not hidden)

- **MRR movement** (EXPANSION/CONTRACTION) is sourced from
  `billing.plan.changed` audit events — a plan change made outside
  `changeSubscriptionPlan()` (e.g. directly in the Stripe dashboard) is
  invisible to movement classification, though current MRR itself stays
  accurate (see `movement.ts`'s own top comment).
- **MRR has no discount concept** — this platform's schema has no
  subscription-level/plan-price-level discount, so MRR always reflects
  the undiscounted catalog rate (see `mrr.ts`).
- **`checkLargeUnexplainedMovement()`** (an anomaly rule for an
  unusually large per-subscription MRR swing) is implemented and unit-
  tested but NOT wired into the control center report — see
  `billing-diagnostics-service.ts`'s own doc comment and
  `financial-controls.md` "Known limitations" for the exact reasoning
  (it needs a per-subscription MRR time series this module's aggregate-
  only movement engine doesn't expose).
- **Historical MRR trend buckets** are reconstructed from currently-
  alive subscriptions' CURRENT pricing, not a true point-in-time
  snapshot — a subscription that has since changed plans contributes its
  current price to every historical bucket, not what it actually billed
  at that point in time. Documented in `revenue-metrics.md`.
