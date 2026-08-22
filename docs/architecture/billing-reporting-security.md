# Billing reporting security (Module 15, extended by Module 16)

The authorization, RLS, and export-security model for every Module 15
AND Module 16 reporting/compliance surface. See `billing-security.md`
(Module 13/14) for the mutation-side security model this document
doesn't repeat.

## Permission set

Four PLATFORM-scope permission keys total (three from Module 15, one
added by Module 16) — never one broad `billing.finance`, the same
tiered-risk split Module 13's own `readPlatform`/`plan.manage`/`refund`
three-way split already established:

| Key | Grants | Why separate |
|---|---|---|
| `billing.analytics.read` | View platform-wide MRR/ARR, revenue reporting, AR aging, financial health, trends. Never payment credentials. | The base "see the numbers" capability. |
| `billing.reports.export` | Export raw report data (invoices/payments/refunds/credits/aging/MRR/deferred-revenue/tax) as CSV. | Deliberately NARROWER than `analytics.read`/`compliance.read` — a CSV is portable/exfiltratable in a way an on-screen dashboard isn't, the same read-vs-export risk split `audit.export`/`audit.exportPlatform` already established in Module 08. |
| `billing.controls.read` | View the operational control center — reconciliation/webhook health, data-consistency diagnostics, anomaly detection. | Diagnostic only; every underlying mutation it links out to (refund, credit, plan change) is independently gated by its OWN existing permission — this key never itself authorizes a write. |
| `billing.compliance.read` (Module 16) | View platform-wide revenue recognition (deferred/recognized revenue) and tax compliance reporting. Never a tax calculation or filing capability. | A narrower, finance/compliance-specific concern than `analytics.read` — a role that needs day-to-day MRR/aging visibility does not automatically need the platform's own deferred-revenue/tax-liability figures (see role grants below). |

Anomaly/reconciliation-diagnostic visibility (including Module 16's own
`checkTaxComponentSumMismatch()`) was folded INTO `billing.controls.read`
rather than given a further key — there is no meaningfully separable
risk between "see the anomaly list" and "see the webhook health
counts"; both are the same diagnostic read. Export of Module 16's
compliance data reuses the EXISTING `billing.reports.export` rather
than a second export key, for the same reasoning — the export risk
tier (a portable CSV) is identical regardless of which report it is.

### Role grants

| Role | `analytics.read` | `reports.export` | `controls.read` | `compliance.read` |
|---|---|---|---|---|
| `platform_owner` | ✓ | ✓ | ✓ | ✓ |
| `platform_admin` | ✓ | — | ✓ | ✓ |
| `support_admin` | ✓ | — | ✓ | — |
| `support_agent` | — | — | — | — |

`platform_admin` and `support_admin` deliberately do NOT get
`billing.reports.export` — day-to-day financial visibility and
diagnostics are granted; bulk raw-data export (the same risk tier as a
full audit-log export) is `platform_owner`-only. Proven directly:
`billing-intelligence.spec.ts`'s own E2E coverage logs in as
`support_admin` and confirms the dashboard/controls pages render while
`/admin/billing/reports` renders the access-denied state.

`support_admin` deliberately does NOT get `billing.compliance.read`,
unlike `analytics.read`/`controls.read` (which it DOES hold) — a
"does this role ever actually need it" boundary, not merely a
data-sensitivity one: MRR/aging/anomalies are all directly useful for
"is this customer's billing healthy" support triage, while
deferred-revenue/tax-liability figures are a finance/compliance concern
with no support-triage use case. Proven by
`billing-compliance.spec.ts`. `platform_admin` DOES get it — plausibly
assembles compliance materials day-to-day, a real, if less frequent,
operational need `support_admin`'s role doesn't share.

### Organization-scoped access, unchanged

An organization's OWN billing data (MRR, aging, revenue, exports) uses
the EXISTING `billing.read` (org-scoped) permission — the same
permission that already lets an owner/admin VIEW this data on
`/organizations/[id]/billing`. Exporting an organization's own data as
CSV is not a materially different risk from viewing it, so no new
org-scoped permission was introduced.

### Platform access never implies organization access, and vice versa

Every PLATFORM-scoped Module 15 function resolves a PLATFORM
authorization context (`resolvePlatformContext()`); every
ORGANIZATION-scoped function resolves an ORGANIZATION context
(`resolveOrganizationContext()`) for that SPECIFIC organization. Holding
`billing.analytics.read` (platform) grants no automatic visibility into
any individual organization's billing page (still gated by that
organization's own `billing.read` membership), and holding an
organization's own `billing.read` grants no platform-wide visibility.
Where the ADMIN org-detail page needs an org-specific figure (financial
health, MRR, aging) for a platform-staff viewer who is NOT a member of
that organization, a dedicated `*ForPlatform()` sibling function exists
(`getOrganizationMrrSummaryForPlatform()`,
`getOrganizationAgingReportForPlatform()`,
`getOrganizationFinancialHealthForPlatform()`) — each independently
gated by `billing.readPlatform`, mirroring the exact pattern Module 14
already established for `getOrganizationBillingForPlatform()`. There is
no code path where a `billing.analytics.read` grant alone unlocks these.

## RLS model

Every Module 15 read goes through `withTenantContext()` — the SAME
session-context transaction wrapper every other tenant-scoped read in
this codebase uses. Two scope shapes:

- **Organization-scoped**: `withTenantContext({userId, organizationId, isPlatformStaff}, ...)`
  — RLS restricts to that organization's own rows; the application-level
  `WHERE organizationId = ...` is defense-in-depth, not the only layer.
- **Platform-scoped**: `withTenantContext({userId: null, organizationId: null, isPlatformStaff: true}, ...)`
  — the repository's application-level `WHERE` clause is INTENTIONALLY
  EMPTY (`scope: {platform: true}` → `where: {}`); Postgres's own
  `tenant_is_platform_context()` function is what grants full
  cross-tenant visibility, not an accidentally-permissive query.

**The superuser database client is never used for an ordinary tenant
read.** Every platform-wide aggregation goes through the same
RLS-respecting `withTenantContext({isPlatformStaff: true})` path,
proven directly — not just asserted — by
`billing-reporting-rls.test.ts`, which runs against the actual
RESTRICTED `alpha_os_app` database role (not the superuser role) and
demonstrates that a zero-WHERE-clause platform query, executed under
Org B's own tenant context (`isPlatformStaff: false`), returns ONLY Org
B's rows — never Org A's — across
`subscriptionRepository.listWithPricedItems()`,
`invoiceRepository.listOpenForAging()`,
`paymentRepository.sumCollectedByCurrency()`, and
`creditLedgerRepository.listAll()`. A fifth test proves a context with
NEITHER an organization NOR the platform-staff flag sees NOTHING at
all, even for a `{platform: true}` scope request — RLS fails closed,
not open.

**Module 16 extends this same proof two hops deep.** `InvoiceLineItemTax`
is transitively owned via `invoice_line_item_id` → `invoice_id` →
`organization_id` — the deepest transitive-ownership chain in this
codebase. `billing-reporting-rls.test.ts`'s own Module 16 tests prove
`invoiceRepository.listLineItemsWithDeferredBalance({platform: true})`
and `listLineItemTaxesForPeriod({platform: true})` under Org B's tenant
context return ONLY Org B's own rows, never Org A's — the two-hop
`EXISTS` policy (`invoice_line_item_taxes` → `invoice_line_items` →
`invoices`) holds exactly as reliably as the one-hop policies above.

**Reports are never a way around RLS.** Every reporting/export function
is a thin wrapper: `requirePermission()` first, then the SAME
tenant-scoped repository calls the rest of the codebase uses. No
reporting query is issued outside a `withTenantContext()` boundary.

## Client-supplied IDs are hints, never trusted

Every route parameter (`organizationId`, report `type`) is validated by
Zod and then independently re-authorized server-side —
`requirePermission("billing.read", organizationId)` re-derives
visibility from the caller's REAL membership, never from the fact that
an ID was present in the URL. Proven by
`billing-intelligence.spec.ts`'s cross-tenant export test: Org A's
owner can export Org A's own invoices (200) but a forged Org B ID on
the same route returns 403, never a silent data leak. An unauthorized
forged report `type` string on the platform export route returns a
plain 404 (`NotFoundError`) — proven to contain no raw stack trace or
SQL text in the response body.

## Export security

- **Streaming, never full-materialization.** Every row-level export
  (invoices/payments/refunds/credits) streams via `streamCsv()`
  (`csv.ts`) — cursor-batched (500 rows/batch), never the full result
  set held in server memory at once. The aggregate exports (AR aging,
  MRR, and Module 16's own deferred-revenue and tax-compliance exports)
  are small enough (one row per bucket/currency/taxability-reason, never
  more than a few dozen rows given each is fed by the same naturally-
  bounded queries their own on-screen reports use — see
  `revenue-recognition.md`/`tax-compliance.md`) to build inline without
  the streaming machinery a naturally-small report doesn't need.
- **A real bug found and fixed during this module's own testing:** a
  `ReadableStream`'s `pull()` callback runs LAZILY, invoked by whoever
  actually reads the stream — AFTER the exporting function itself has
  already returned and its `withTenantContext()` transaction has
  already committed. The first implementation captured a `tx` in a
  closure at that point — a reference to an ALREADY-CLOSED transaction,
  throwing `PrismaClientKnownRequestError: Transaction already closed`.
  Found via a real integration test AND confirmed live via `curl`
  against the production build. Fixed by introducing a `TenantScope`
  (plain data, not a transaction handle) and opening a FRESH, short-lived
  `withTenantContext()` per batch inside `fetchBatch` — the same
  "transactions stay short" discipline this codebase already follows
  everywhere else, applied across N batches instead of one long-held
  connection for the whole response.
- **CSV injection defense.** Any field beginning with `=`, `+`, `-`, or
  `@` (which Excel/Sheets may interpret as a formula) is prefixed with a
  neutral leading `'` (`escapeCsvField()`, `csv.ts`) — the same defense
  `lib/audit/query.ts`'s own CSV export already uses, reused, not
  reimplemented. Proven by `csv.test.ts` and exercised live in
  `billing-intelligence.spec.ts`'s export tests.
- **Money in an export column is an exact decimal string**, built
  directly from the integer minor-unit value via string manipulation
  (`moneyColumn()`, `billing-export-service.ts`) — never
  `minorUnits / 10 ** exponent` float division. A first draft used
  `fromMinorUnits().toFixed(20)`, itself a float-division violation of
  this codebase's own "never float arithmetic for money" rule even in
  presentation output; corrected before merge.
- **Every export requires authentication and its own permission check**
  — `requirePermission()` runs before any row is fetched, platform
  exports via `billing.reports.export`, organization exports via that
  organization's own `billing.read`.

## Audit coverage for exports

`billing.report.exported` (Module 08 catalog) records the REQUEST — who,
which report type, which filters, when the export STARTED — not a final
row count. This is a deliberate tradeoff, not an oversight: counting
rows for a genuinely-streamed export would require materializing the
entire result before responding, exactly the memory cost streaming
exists to avoid. The request itself (who asked for what) is the
security-relevant fact worth recording; the exact byte count of a large
CSV is not.

## Adversarial coverage exercised

Directly tested (across the 7 new integration test suites plus
`billing-intelligence.spec.ts`'s E2E coverage):

- Forged `organizationId` on every platform-scoped repository/service
  call (RLS-proven, not just application-layer-proven).
- Cross-tenant export attempt (Org A owner → Org B's export route) →
  403.
- Unauthorized access to the dashboard/organizations directory/controls/
  reports pages by a customer-organization owner and by an
  under-permissioned platform role (`support_agent`) → access-denied
  state, never a partial render.
- CSV-injection-shaped organization/customer display names → escaped,
  not executed.
- Forged/unknown export report `type` → safe 404, no raw error leak.
- A context with no organization and no platform-staff flag → sees
  nothing, even for a platform-scoped query (`billing-reporting-rls.test.ts`).

Not yet independently exercised as a DEDICATED test (tracked here
rather than silently assumed covered): stale session after permission
removal, revoked membership mid-session, and pagination-cursor
tampering on a Module 15 export cursor specifically — the general
mechanisms these would exercise (`requirePermission()` re-resolving
context on every call, cursor-based pagination's own opaque-cursor
design) are shared, already-tested infrastructure from Module 05/13, not
new code this module introduces, so a regression here would surface as
a Module 05/13 regression, not a Module-15-specific gap.
