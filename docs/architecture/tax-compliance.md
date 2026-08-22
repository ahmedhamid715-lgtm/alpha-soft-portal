# Tax compliance reporting (Module 16)

Reports on tax the PAYMENT PROVIDER already calculated and charged.
This module calculates NO tax of its own — no rate lookup, no nexus
determination, no jurisdiction logic. See `billing-intelligence.md` for
how this fits alongside Module 15, and "What this does NOT claim to
be" below before assuming this is more than it is.

## Why no tax calculation engine

A real multi-jurisdiction sales/VAT tax engine needs external rate and
nexus data (which US state/county/city rates apply to which customer
address, which jurisdictions this business has nexus in, exemption
rules, filing thresholds) that this platform does not have and has no
way to source correctly. Building one with invented or hardcoded rates
would be a textbook "fake enterprise feature" — worse, a legally
significant one, since tax miscalculation has real consequences.
Instead: Stripe (via Stripe Tax, or a manually configured tax rate) is
the SOLE source of tax calculation; Alpha OS's job is to capture and
report on what Stripe already charged, honestly and completely — never
to second-guess or recompute it.

## What's captured

Stripe sends real per-component tax detail on every invoice line
(`line.taxes[]`) — Module 13 originally only kept the SUM
(`InvoiceLineItem.taxAmount`); Module 16 additionally captures each
component in full, into `InvoiceLineItemTax`:

| Field | Source | Notes |
|---|---|---|
| `amount` | `tax.amount` | Minor units — this component's own share of the line's total tax. Always present. |
| `taxabilityReason` | `tax.taxability_reason` | Stripe's own already-classified reasoning (`standard_rated`, `product_exempt`, `reverse_charge`, `not_collecting`, ...) — real provider data, never inferred by Alpha OS. An open-ended string, not an enum (Stripe's own type explicitly allows values beyond its documented list). |
| `taxBehavior` | `tax.tax_behavior` | `'exclusive'` or `'inclusive'`, stored as-is. |
| `providerTaxRateId` | `tax.tax_rate_details.tax_rate` | Stripe's own tax rate id (e.g. `txr_...`) — see "Why tax rate ids are not resolved" below. |

A line can carry MULTIPLE simultaneous components (e.g. a US state +
county + city rate stacked on one line) — real detail the old
rolled-up sum couldn't represent, and the actual justification for
`InvoiceLineItemTax` being a separate table (see its own doc comment in
`prisma/schema.prisma` for the full "why a new table" reasoning).

## Why tax rate ids are not resolved

`providerTaxRateId` is preserved as an OPAQUE reference — deliberately
never resolved to a human jurisdiction name or percentage (e.g. "7.25%
— Alameda County, CA"). Resolving it would require a live
`stripe.taxRates.retrieve()` API call per unique rate id. This dev/test
environment has no configured Stripe secret key at all
(`isStripeConfigured` is `false`), meaning such a call could be written
but never actually exercised or verified against a real Stripe
response in this environment — the same honest limitation every other
Stripe-touching feature in this codebase already lives with. Rather
than build an unverifiable code path, the raw provider id is reported
as-is: still a stable, real, useful grouping key (two components with
the same `providerTaxRateId` are genuinely the same tax rate, even
without a human label for it), and a documented future integration
point, not a gap papered over with a fabricated jurisdiction name.

## The report

**`getPlatformTaxComplianceReport()`** — tax collected for invoices
ISSUED within a requested period, two views:

- **Totals by currency** — the single "tax collected" headline figure
  per currency, never blended across currencies.
- **Breakdown** — grouped by `(currency, taxabilityReason, providerTaxRateId)`,
  the finest split this platform can honestly produce. A `null`
  `taxabilityReason`/`providerTaxRateId` from the provider is grouped
  under the literal string `"unknown"` — never silently dropped from
  the report (a missing classification is itself a fact worth
  surfacing, not hiding).

**Excluded**: `DRAFT` invoices (never actually issued — same reasoning
`revenue-metrics.md`'s own `sumBilledByCurrency()` already
establishes).

## Where the tax integrity check lives, and why

`checkTaxComponentSumMismatch()` (`lib/billing/reporting/anomalies.ts`)
— a REAL data-integrity check, added to Module 15's existing anomaly
framework rather than a parallel one: `InvoiceLineItem.taxAmount` (the
rolled-up sum) and the independently-summed `InvoiceLineItemTax` rows
for the SAME line are written from the SAME webhook payload at the
same moment and must always agree; a mismatch is a genuine signal the
two write paths drifted.

This lives under the control center's existing `billing.controls.read`
gate (`/admin/billing/controls`), NOT the new `billing.compliance.read`
— it's an INTEGRITY diagnostic ("did we ingest consistently"), not
compliance REPORTING data itself. Bounded to the current month on every
control-center load (the same "bounded, meaningful slice, never the
platform's unbounded full history" discipline every other consistency
check in that report already follows).

## Why this is platform-only, not organization-facing

Same reasoning as `revenue-recognition.md`'s own section: tax
collected/remitted is the platform operator's own compliance concern
(what Alpha Page Rankers itself owes a taxing authority), not something
an individual customer organization needs a dedicated view into (a
customer already sees their own invoice's tax line on their own
invoice detail page, unchanged since Module 13).

## What this does NOT claim to be

- **Not a tax calculation engine.** Zero rate lookup, zero nexus
  determination, zero exemption logic. Every amount reported is exactly
  what Stripe already charged — Alpha OS neither verifies nor
  recomputes it.
- **Not a filing capability.** No connection to any tax authority, no
  return preparation, no remittance. This report is an input a human
  (or a real tax-filing tool) uses — never a substitute for one.
- **Not jurisdiction-aware.** `providerTaxRateId` is an opaque
  reference; this platform does not know or claim to know which
  jurisdiction a given rate belongs to (see "Why tax rate ids are not
  resolved" above).
- **Not multi-provider.** Only Stripe's own tax-component shape is
  modeled; a second payment provider with a different tax-representation
  shape is out of scope.

## Known limitations

- **No backfill.** Line items created before this module's migration
  have zero `InvoiceLineItemTax` rows, even if their rolled-up
  `taxAmount` is nonzero — that per-component detail was already lost
  at ingestion time under the old (Module 13) mapping and cannot be
  honestly reconstructed. This is exactly the case
  `checkTaxComponentSumMismatch()` would flag if such a line fell
  within its current-month scan window — a real, honest signal that
  older data lacks this module's detail, not a bug.
- **No resolved jurisdiction name or tax percentage** — see "Why tax
  rate ids are not resolved" above.
