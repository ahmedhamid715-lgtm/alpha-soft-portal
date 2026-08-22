# Billing data model (Module 13)

Every billing model, its ownership classification, and why — spec §31's
own explicit instruction: "Before creating policies: classify every
billing model. Do not blindly add `organizationId` to every table."

## The domain chain

```text
Organization
    └── BillingAccount (1:1, lazily created)
          ├── Subscription[] (usually one current; history preserved, never deleted)
          │     └── SubscriptionItem[] (transitively owned)
          ├── Invoice[]
          │     └── InvoiceLineItem[] (transitively owned, immutable)
          ├── Payment[]
          │     └── Refund[] (transitively owned)
          └── CreditLedgerEntry[] (append-only)

Plan (platform-wide, no RLS)
    └── PlanPrice[] (platform-wide, no RLS)

BillingWebhookEvent (platform infrastructure, no RLS, no organizationId)
```

`provider`/`providerXxxId` columns exist on nearly every model — these
are external REFERENCES, never a substitute for the row's own identity
(spec §3). Alpha OS's own `id` (UUIDv7) is what every foreign key,
every URL, and every internal join actually uses.

## Ownership classification

| Model | Classification | RLS shape | Reasoning |
|---|---|---|---|
| `BillingAccount` | Organization-owned | Direct `organization_id` column, standard tenant-isolation policy | The organization's own commercial relationship — no reason to ever query across organizations except platform staff. |
| `Subscription` | Organization-owned | Direct `organization_id` column | Denormalized from `billingAccountId` deliberately, for RLS simplicity and query performance (spec allows this — it's the same pattern `Invitation`/`Invoice` already use elsewhere in this codebase: a child table with its own parent-organization already has a direct FK too, RLS is always keyed on the DIRECT column, never a join, for every "directly owned" table in this project). |
| `SubscriptionItem` | Transitively organization-owned (via `subscription_id`) | `EXISTS` subquery to `subscriptions`, same pattern `role_permissions` established for a transitively-owned child (Module 05) | No `organizationId` of its own — a subscription's items are never queried independent of their subscription. |
| `Invoice` | Organization-owned | Direct `organization_id` column | Same reasoning as `Subscription`. |
| `InvoiceLineItem` | Transitively organization-owned (via `invoice_id`) | `EXISTS` subquery; **no UPDATE policy at all** | Immutable after creation (spec §11) — the RLS layer enforces this structurally, not just by service-layer discipline: even a caller with a legitimate tenant context cannot UPDATE a line item, because no UPDATE policy exists to grant it. |
| `Payment` | Organization-owned | Direct `organization_id` column | Same reasoning as `Subscription`/`Invoice`. |
| `Refund` | Transitively organization-owned (via `payment_id`) | `EXISTS` subquery; **no DELETE policy at all** | A refund, once recorded, is never removed (spec §37) — same structural enforcement as `InvoiceLineItem`'s immutability. |
| `CreditLedgerEntry` | Organization-owned | Direct `organization_id` column; **INSERT/SELECT only — no UPDATE/DELETE policy at all** | Append-only ledger (spec §14) — the database itself, not just the service layer, refuses to let ANY role (including platform staff) mutate or remove an entry. A correction is a new, offsetting entry. |
| `Plan` / `PlanPrice` | Platform-wide reference data | **No RLS at all** | Every organization must see the SAME active catalog — there is no "wrong tenant" a plan/price could leak across; the real access boundary is `billing.plan.manage` (a permission check), not a Postgres policy. Same reasoning `organizations` itself has no RLS (see `organization-security.md`). |
| `BillingWebhookEvent` | Platform infrastructure | **No RLS, no `organizationId` column at all** | See `billing-webhooks.md` "Why this table has no RLS." |

## Why `Subscription`/`Invoice`/`Payment` carry a direct `organizationId` instead of only `billingAccountId`

Every real-world query this module needs ("this organization's
invoices," "this organization's payments," RLS itself) filters by
organization, not by billing account — and since `BillingAccount` is a
strict 1:1 with `Organization` anyway, a direct `organizationId` column
is simply the more useful, more RLS-friendly denormalization, at the
cost of one extra column per row (cheap) instead of a JOIN on every
single query and every single RLS policy evaluation (not cheap at the
"thousands to millions of customers" scale this module is built for —
spec's own framing). `billingAccountId` is kept alongside for the
genuine 1:1 relationship and referential integrity; it is never the
join RLS actually uses.

## Money

Every monetary column is an `Int` of MINOR units (spec §7) — reusing
`src/lib/utils/money.ts` (Module 01), never a second money
representation. `toMinorUnits()`/`fromMinorUnits()`/`formatMoney()` are
the only three places a JavaScript floating-point number is allowed to
represent money at all — human-entered form input in, human-readable
display out. See that file's own doc comment for zero-decimal
(`JPY`/`KRW`/...) and three-decimal (`BHD`/`KWD`/...) currency handling,
unchanged and reused as-is here.

## What was evaluated and deliberately not modeled

- **A cached credit balance column** — deliberately absent (spec §14).
  `lib/billing/ledger.ts`'s `computeCreditBalance()` sums the ledger on
  every read. If a future module adds a cache for read performance, it
  must be documented as a projection derived from this same
  computation, never a second source of truth.
- **A `PlanFeature` table** — folded into `Plan.metadata` (a JSON bag)
  instead. No concrete feature-gating consumer exists yet to justify a
  first-class table with real columns; adding one speculatively would
  be exactly the "invent structure nobody reads yet" this project's
  established discipline (Module 12's own identical restraint for
  settings) already rejects.
- **A `PaymentMethod` table** — deliberately absent. Payment method
  management is entirely Stripe Billing Portal's job (spec §25); Alpha
  OS never stores more than the safe display fields already on
  `Payment` itself (`paymentMethodType`/`Brand`/`Last4`), and never a
  reusable, updatable "this organization's saved card" record.
