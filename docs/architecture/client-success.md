# Client Success

Build 25 — Roadmap Module 19. Interprets the customer data Customer 360
(Build 24) already composes into a health score, engagement signal,
payment/onboarding/project/support/service-performance breakdown, a
deterministic churn-risk classification, and two narrow, genuinely
persisted workflows (renewal tracking, expansion opportunities), plus
Client Success ownership. Roadmap Module 20 (Customer Portal) is next
and was **not** started by this build.

The two rules that shaped every decision below:

1. **Never treat missing data as bad data.** An unmeasurable component
   is excluded from the weighted average entirely — never scored 0.
2. **This is not the future Churn & Risk Engine (Roadmap Module 69).**
   `evaluateChurnRisk()` is deliberately simple, deterministic,
   explainable, rule-based — no ML, no learned weights, no opaque score
   — and is the documented seam Module 69 replaces or extends.

## Relationship to Customer 360

**Client Success interprets Customer 360's data. It does not replace
the source domains, and it does not duplicate Customer 360's own
composition.**

```
CrmCompany
    │
    ├── getCustomer360()  (Build 24 — composes CRM/Sales/Onboarding/Billing)
    │         │
    │         ▼
    │   getClientSuccessHealth()  (Build 25 — interprets, does not re-fetch)
    │         │
    │         ├── Payment      ← company360.billing + getOrganizationFinancialHealthForPlatform()
    │         ├── Onboarding   ← company360.currentOnboardingDetail + company360.health
    │         ├── Engagement   ← company360.activity[0] (composeCustomerTimeline() output)
    │         ├── Project      ← NOT_MEASURABLE (no Roadmap Module 21 yet)
    │         ├── Support      ← NOT_MEASURABLE (no Roadmap Module 30 yet)
    │         └── Service      ← NOT_MEASURABLE (no Roadmap Module 23+delivery yet)
    │
    └── CrmClientSuccessProfile / Renewal / ExpansionOpportunity (new, narrow, persisted)
```

No new `Customer` table, no duplicated identity resolution — the
canonical root is still `CrmCompany.id`, and the `CrmCompany ↔
Organization` bridge is still `convertedToOrganizationId`, resolved
exactly once (inside `getCustomer360()`) and never re-derived here.

`getClientSuccessHealth()` accepts an optional `precomputedCompany360`
so the Customer 360 page — which already fetched its own
`Customer360ViewModel` for the rest of the page — can pass it straight
through instead of this function issuing a second, fully redundant
`getCustomer360()` composition. A defensive same-`companyId` check
guards against a caller bug ever silently computing health for the
wrong customer; every other caller (the portfolio, the AI-context
service) omits it and gets a plain, self-contained fetch.

## Health architecture

Six components, each independently evaluated by a pure function in
`src/lib/crm/client-success.ts`, then combined by
`computeCustomerHealth()`:

| Component | Weight | Source | Measurable when |
|---|---|---|---|
| Payment | 30 | `getOrganizationFinancialHealthForPlatform()` (Build 14) | Linked organization exists, caller has `billing.readPlatform`, and a billing account exists |
| Onboarding | 25 | Build 23's own onboarding status/createdAt/progress | An onboarding has ever started |
| Engagement | 20 | Customer 360's own `composeCustomerTimeline()` output | Any activity/lifecycle event exists |
| Project | 15 | — | Never (no Roadmap Module 21 yet) |
| Support | 5 | — | Never (no Roadmap Module 30 yet) |
| Service performance | 5 | — | Never (no Roadmap Module 23+delivery yet) |

Weights are fixed and documented (`HEALTH_COMPONENT_WEIGHTS`), frozen
once during this build's architecture freeze, never tuned or learned.
Project/Support/Service reserve real weight now so that when those
Roadmap modules exist and the components become measurable, the
overall score's balance shifts the way it was always meant to, without
a redesign.

### Score formula

Each component is classified into the shared five-tier `HealthStatus`
(`HEALTHY | WATCH | AT_RISK | CRITICAL | NOT_MEASURABLE` —
`src/lib/crm/client-success.ts`), which reuses `FinancialHealthClassification`'s
own four measurable tiers (Build 14) plus one addition,
`NOT_MEASURABLE`, so Payment Health's own classification plugs in
directly with no translation layer.

A measurable component's numeric score is **derived** from its status
via a fixed mapping (`HEALTH_STATUS_SCORE`: HEALTHY=100, WATCH=65,
AT_RISK=35, CRITICAL=10) — not an independently continuous
calculation. A finer-grained number would be false precision this
build has no data to actually support; this is documented explicitly
rather than silently implied.

The overall score is a **weighted average over MEASURABLE components
only, renormalized against the sum of their own weights** — never
divided by the fixed 100-point total, which would silently punish a
customer for a dimension that simply has no source domain yet:

```
overallScore = round( Σ(weight[c] × score[c]) / Σ(weight[c]) )   for c in measurable components
```

Zero measurable components → `overallScore: null`,
`overallStatus: "NOT_MEASURABLE"` — never a fabricated 0. The overall
score is then bucketed back into a status using the same four
documented cutoffs (`scoreToStatus()`: ≥80 HEALTHY, ≥55 WATCH, ≥30
AT_RISK, else CRITICAL).

### Coverage / confidence

Every `CustomerHealthResult` exposes `coverage: { measurable, total }`
(e.g. "2 of 6 components measurable") so the UI never implies more
certainty than the data supports — shown directly in the Health
section's own description text, not buried.

### Missing-data semantics, per component

- **Payment** — `NOT_MEASURABLE` (not "perfect health") when there's no
  linked organization, the caller lacks `billing.readPlatform`, or no
  billing account exists. This gate is evaluated explicitly in
  `resolvePaymentHealth()` (`crm-client-success-health-service.ts`)
  BEFORE trusting `getOrganizationFinancialHealthForPlatform()`, whose
  own "no billing account → `billingAccountStatus: null` → falls
  through to HEALTHY" default would otherwise silently read a missing
  billing account as perfect payment health — a real Codex Security/
  data-honesty concern, fixed at the gate rather than inside Build 14's
  own service.
- **Onboarding** — `NOT_MEASURABLE` when no onboarding has ever started
  (a normal state for a prospect/pre-sale company, not a red flag). A
  freshly-started onboarding gets a 14-day grace window before being
  judged by elapsed time/progress percentage at all — day-one/day-two
  onboardings never get flagged.
- **Engagement** — `NOT_MEASURABLE` when no activity, deal, proposal,
  contract, or onboarding event exists for the customer at all.
  Deliberately NOT inferred from page views, portal usage, email opens,
  or notification delivery — none of those are tracked, and fabricating
  them would violate the "never treat missing data as bad data" rule in
  the other direction (inventing GOOD data).
- **Project / Support / Service performance** — always `NOT_MEASURABLE`
  until their owning Roadmap module exists. Each returns the exact same
  shape via one shared `notYetAvailable()` helper — deliberately not a
  plugin registry or abstraction layer (no abstraction theater for
  domains that don't exist yet), just three small functions, each
  documenting exactly which future module replaces it.

## Component output shape

Every `HealthComponent` carries: `key`, `label`, `status`,
`score` (only non-null when measurable), `measurable: boolean`,
`reason` (plain English, built from real values — never a vague "seems
unhealthy"), `source` (which domain the data came from, or which
future Roadmap module owns it while unmeasurable), and
`lastEvaluatedAt`. The `reason` is always rendered as visible text in
the UI (`ComponentCard` in `client-success-health-tab.tsx`) — an early
draft that put it in an `sr-only` span was caught and fixed, since
hiding the "why" defeats the entire point of a component-level
breakdown.

## Engagement

`evaluateEngagement()` buckets the most recent entry from Customer
360's own already-composed timeline by recency: ≤30 days HEALTHY,
31–60 WATCH, 61–90 AT_RISK, >90 CRITICAL, no entry ever
`NOT_MEASURABLE`. Zero new queries — it reads
`company360.activity[0].timestamp`, the same `CrmActivity` +
deal/proposal/contract/onboarding lifecycle-milestone timeline Build 24
already assembled.

## Project health boundary

`evaluateProjectHealth()` always returns `NOT_MEASURABLE` — Roadmap
Module 21 (Project Management) doesn't exist. A typed extension point,
not a stub that silently returns a fake "on track."

## Payment health

`toPaymentHealthComponent()` wraps an ALREADY-COMPUTED
`FinancialHealthResult` from `getOrganizationFinancialHealthForPlatform()`
— no formula duplicated, no direct Stripe calls, correct currency
handling (whatever Build 14's own service already returns), deterministic
thresholds (Build 14's own, unchanged). See "Missing-data semantics"
above for the NOT_MEASURABLE gate.

## Support health boundary

`evaluateSupportHealth()` always returns `NOT_MEASURABLE` — Roadmap
Module 30 (Support Center) doesn't exist. No fabricated ticket count,
SLA adherence, CSAT, or response time.

## Service performance boundary

`evaluateServicePerformance()` always returns `NOT_MEASURABLE` —
distinct from Customer 360's own "Services" tab, which shows services
**sold** (Build 23's onboarding/proposal snapshots). Whether those
services are **performing well** for the customer is not tracked by
any domain yet (Roadmap Module 23 and future delivery modules).

## Churn risk

`evaluateChurnRisk()` — deterministic, rule-based, fully explainable.
Levels: `LOW | MEDIUM | HIGH | UNKNOWN`. Reason codes:
`PAYMENT_OVERDUE`, `CONTRACT_EXPIRING`, `CONTRACT_EXPIRED_UNRESOLVED`,
`ONBOARDING_BLOCKED`, `ONBOARDING_STALLED`, `LOW_ENGAGEMENT` — each
tagged `critical: boolean`.

Severity: a single critical-weight reason (payment CRITICAL, a
contract already expired with no open renewal, or a blocked
onboarding) forces `HIGH` on its own. Otherwise each additional
non-critical reason escalates: 0 → `LOW`, 1 → `MEDIUM`, 2+ → `HIGH`.
`UNKNOWN` only when literally nothing about the customer is measurable
at all (payment, onboarding, engagement all unmeasurable AND no active
contract with a known end date) — never fabricated as `LOW` just
because no bad news was found.

This is explicitly **not** Roadmap Module 69 (the real Churn & Risk
Engine) — it's the documented, replaceable seam that module is meant
to extend or replace, not the thing itself.

## Renewal tracking

A real, persisted domain — justified because renewal lifecycle state
(who's tracking it, what stage it's in, the outcome) doesn't exist
anywhere else and is genuinely stateful, unlike health/risk which are
pure derivations recomputed live.

`CrmClientSuccessRenewal`: `companyId`, `contractId` (must belong to
the same company — enforced by a DB trigger, not just app code),
`renewalDate` (defaults from `contract.endDate` when not supplied —
never a fabricated date), `status`
(`UPCOMING | IN_PROGRESS | RENEWED | NOT_RENEWING | EXPIRED`),
`ownerUserId`, `expectedValueMinorUnits`/`expectedValueCurrency`,
`notes`, `outcome` (required at a terminal transition — enforced by a
CHECK constraint), `createdByUserId`.

Rules: at most one OPEN (`UPCOMING`/`IN_PROGRESS`) renewal per
contract, enforced by a partial unique index
(`crm_client_success_renewals_one_open_per_contract`) — not just app
logic. Historical renewals are preserved (no DELETE — the migration
revokes DELETE and no repository/service function issues one). Renewal
never auto-alters billing and never amends the underlying `CrmContract`
— it's a tracking record about the customer relationship, not a
contract mutation.

## Expansion opportunities

A narrow Client-Success-identified growth signal — explicitly **not** a
second Sales Pipeline. No stage, no probability, no forecast.

`CrmClientSuccessExpansionOpportunity`: `title`, `rationale` (required
— "why this is a real signal," enforced NOT NULL at the DB layer),
`estimatedValueMinorUnits`/`estimatedValueCurrency` (optional),
`ownerUserId`, `status`
(`IDENTIFIED | QUALIFIED | HANDED_TO_SALES | DISMISSED`),
`handedToDealId` (nullable FK, set only via the controlled hand-off
transition — an expansion opportunity never auto-creates a `CrmDeal`;
a staff member picks an EXISTING open deal, or leaves it unlinked).
A DB trigger enforces that a linked deal belongs to the same company as
the expansion opportunity.

## Client Success ownership

`CrmClientSuccessProfile` — one row per company (unique on
`companyId`), holding `csOwnerUserId` and the management-attention
flag/reason. Reuses the existing `User` model directly; no new
Employee/Staff table. Ownership is independent of the original sales
rep — a Client Success owner is assigned explicitly, never assumed to
be whoever closed the deal.

## Manual overrides

There is no numeric health-score override. The Build 25 authorization's
own instruction was to avoid arbitrary overrides that could silently
mask real signals — instead there's exactly one manual signal: a
**management-attention flag** (`managementAttentionFlag` +
`managementAttentionReason`), which is permission-controlled
(`crm.client_success.manage`), reason-required (a CHECK constraint —
`(management_attention_flag = false) OR (NULLIF(BTRIM(management_attention_reason), '') IS NOT NULL)`,
not just `IS NOT NULL`, so a whitespace-only reason is rejected at the
DB layer even if a caller bypasses the Zod validation), audited
(`crm.client_success.attention_flag_set`/`_cleared`), and rendered
completely separately from the computed Health section — never
presented as if it changed the score.

## Persistence

**Health and churn risk are computed LIVE on every call — no snapshot
table, no cache, no scheduler.** No fabricated trend charts (there's no
historical series to chart honestly). This was a deliberate choice
among live-only vs. live+snapshots: no scheduling infrastructure exists
in this codebase to populate snapshots on a cadence, and a snapshot
table with no reliable writer would either go stale silently or require
inventing a scheduler out of scope for this build.

Three new tables ARE persisted, because their own state is genuinely
stateful and nowhere else: `CrmClientSuccessProfile`,
`CrmClientSuccessRenewal`, `CrmClientSuccessExpansionOpportunity` — all
platform-organization-owned, all RLS-protected (see "Row-level
security" below), all upsert/insert-and-update only (no DELETE).

## Authorization

`crm.client_success.read` / `crm.client_success.manage` — a dedicated
permission pair, deliberately distinct from `crm.read`/`crm.manage`.
Unlike Customer 360 (which reused `crm.read` since its own floor needed
nothing more), health/risk classification and renewal/expansion
pipeline detail are business-sensitive information a caller with only
ordinary CRM read access shouldn't automatically see. Granted to
`platform_owner`/`platform_admin` (both permissions) and `support_admin`
(read only). No separate `.override` permission exists — there is no
override capability to gate; the management-attention flag is an
ordinary `.manage` action.

`getClientSuccessHealth()` requires `crm.client_success.read` as its
own floor, then internally calls `getCustomer360()`, which
re-verifies its OWN `crm.read` floor and per-section gates
independently — never bypassed, never assumed. A caller who somehow
had `crm.client_success.read` but not `crm.read` would still be
correctly denied by the inner call (this exact composition, not a
hypothetical — `getCustomer360()`'s own authorization is not
short-circuited just because it's called from within another
already-authorized service function).

## Row-level security

All three new tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
SECURITY`, `tenant_isolation_select/insert/update` policies keyed off
the session's tenant context, no delete policy, `REVOKE DELETE` from
the restricted app role. Verified directly (integration tests +
live psql checks during the Codex DB Engineer build-out):

- No tenant context → zero rows returned, across all three tables.
- A renewal's `contractId` must belong to the SAME company as the
  renewal — enforced by `crm_client_success_enforce_relationship_integrity()`
  (a `SECURITY INVOKER` trigger, branches on `TG_TABLE_NAME`, uses
  `to_jsonb(NEW) ->> 'key'` for polymorphic-safe column access — the
  same trigger pattern Build 23 established). A forged cross-company
  `contractId` is rejected by the trigger, not merely by app code.
- An expansion's `handedToDealId`, when set, must belong to the SAME
  company — enforced by the same trigger function.
- A forged/nonexistent `companyId` on any Client Success service call
  (`getClientSuccessHealth`, `listRenewalsForCompany`,
  `setClientSuccessOwner`, ...) rejects with `NotFoundError` at the
  service layer, which resolves the company through the existing,
  already-tenant-scoped `getCompanyOrThrow()` helper — never trusts a
  caller-supplied id directly against a second table.
- A duplicate OPEN renewal for the same contract is rejected by the
  partial unique index, not just a pre-check (defense in depth against
  a race between the pre-check and the insert).

## Concurrency — CAS on terminal-lifecycle transitions

A Codex Security Engineer review found a Medium-severity race: several
renewal/expansion transition functions checked "is this still
non-terminal?" and then issued a plain `update()` keyed only on `id` —
allowing a concurrent terminal transition to land in between and get
silently overwritten or resurrected. This is the SAME bug class
Build 23's own `setOnboardingStatus()` was found vulnerable to and
fixed; an earlier draft of this build's own code incorrectly assumed
Build 23's function was already CAS-safe and didn't need the same
treatment — corrected once the parallel finding surfaced.

Fixed: `renewal.update()`/`renewal.setInProgress()`/
`expansion.update()`/`expansion.setQualified()` are all real
`updateMany()`-based compare-and-swap, guarded on the row still being
in a non-terminal status, returning `null` on a lost race rather than
silently no-op'ing or throwing a generic error. The four corresponding
service functions (`updateRenewal`, `startRenewal`,
`updateExpansionOpportunity`, `qualifyExpansionOpportunity`) surface a
lost race as `ConflictError`. `transitionTerminal()` on both
repositories was already CAS-correct from the start. Regression
coverage: `tests/integration/db/client-success-security-regression.test.ts`
proves a "lost race" `update()`/`setInProgress()` call after a renewal
has already been closed `RENEWED` returns `null` and never mutates the
closed row.

## Audit

Only meaningful mutations are audited — never a computed health/risk
read. Nine actions in the catalog: `crm.client_success.owner_changed`,
`attention_flag_set`/`attention_flag_cleared`, `renewal_created`,
`renewal_status_changed`, `expansion_identified`,
`expansion_status_changed`, `expansion_handed_to_sales`,
`expansion_dismissed`.

## Notifications

Three new event-driven templates, wired through the EXISTING
notification infrastructure (`templates.ts` + `subscribers.ts`):
`crm.client_success.owner_assigned`,
`crm.client_success.renewal_owner_assigned`,
`crm.client_success.expansion_owner_assigned` — each fires when a
person is assigned as owner of something, notifying that person.

**Deliberately not built:** a "renewal in 30 days" or "contract
expiring soon" reminder. No durable scheduling infrastructure exists
in this codebase (no cron/job queue) — building one just for this
reminder would be out of scope and would need its own reliability
story. The portfolio's own "Contracts expiring without an open
renewal" section is the honest substitute: a real-time, on-demand bulk
view rather than a fabricated push notification with no reliable
trigger behind it. Documented here as a known future integration point
once durable scheduling exists.

## Performance

The Build 25 authorization's own most emphatic warning was against a
portfolio that loops `getCustomer360()` once per customer. This build's
`getClientSuccessPortfolio()` does not do this — see the service's own
top comment. Every section is one or two bounded, org-wide queries via
`Promise.all`, and the query count does not scale with the number of
customers beyond the bound each individual query already carries:

- `listAtRiskOrganizations()` — Build 14's own existing bulk
  payment-risk query (an accepted, already-reviewed precedent, not new
  to this build).
- `listActiveContractsExpiringWithoutOpenRenewal()` — a NEW bulk query,
  fixed once by a Codex Performance Engineer finding: the second half
  (open renewals for the expiring contracts) was originally unbounded
  (org-wide, no filter). Fixed by sequencing — fetch the expiring
  contracts FIRST (capped at 200, early-return `[]` if none), then
  filter the open-renewal query to `contractId: { in: those ids }`.
- `listForOrganization({ openOnly: true })` /
  `listForOrganization({ status: "IDENTIFIED" })` — direct, indexed,
  organization-scoped queries.
- `listOnboardings({ status: "BLOCKED" })` — Build 23's own existing
  bounded service call.
- `listByConvertedOrganizationIds()` — one new bulk reverse-lookup on
  `crmCompanyRepository`, replacing what would otherwise be an N+1
  company-lookup loop over the at-risk organizations.

A second Codex Performance Engineer finding: the new expiring-contracts
query filters/sorts by `endDate`, which no existing Build 22 index led
with after `status`. Fixed by adding
`@@index([organizationId, status, endDate])` to `CrmContract` —
justified as a genuinely NEW access pattern this build introduces, not
a re-audit of Build 22's own existing queries.

The one accepted per-customer cost in the whole build is
`getClientSuccessHealth()` itself, called from the Customer 360 page
for exactly ONE customer per page view (never in a loop) — and even
there, the redundant-`getCustomer360()`-call problem is avoided via
`precomputedCompany360` (see "Relationship to Customer 360").

## Accessibility

`tests/e2e/client-success-accessibility.spec.ts` — axe-core, zero
violations required. Covers: the portfolio page (desktop light/dark,
mobile/tablet), the Customer 360 Client Success tab in its
`canManage` (platform-admin) state with a realistic measurable/
not-measurable mix plus interactive reveal states (management-attention
reason textarea, renewal outcome textarea, expansion hand-off deal
picker), the same tab in its read-only (support-admin,
`crm.client_success.read` only) state, and a fully bare/empty-state
company (no contract, no billing, no CS data at all — every component
`NOT_MEASURABLE`, churn `UNKNOWN`, both lists rendering their
`EmptyState`). Two shared logins for the whole file (`beforeAll`, one
per role), not one per test — the same `authRateLimiter`-exhaustion fix
Build 23 established, extended here to two roles since the
`canManage`-gated DOM genuinely differs and both need coverage.

## Testing

- **Unit** (`tests/unit/lib/crm/client-success.test.ts`, 23 tests):
  every formula and edge case — zero-denominator/coverage, "missing
  never drags the score down," renormalization, all four churn-risk
  tiers, contract-expiry with and without an open renewal.
- **Integration/security**
  (`tests/integration/db/client-success-security-regression.test.ts`,
  7 tests): terminal-lifecycle CAS race (renewal and the service-layer
  `ConflictError` it surfaces), whitespace-only management-attention
  reason rejected at the DB layer, RLS fail-closed with no tenant
  context, forged cross-company `contractId`/`dealId` rejected,
  forged/nonexistent `companyId` rejected with `NotFoundError`.
- **E2E** (`tests/e2e/client-success.spec.ts`, 7 tests): access control
  (unauthorized role, customer-org member), the portfolio showing a
  real expiring contract and linking to Customer 360 (plus responsive
  behavior), the full Customer 360 integration workflow (owner
  assignment, management-attention flag, renewal create → start →
  close, expansion identify → qualify → dismiss), permission denial on
  the tab itself, not-found behavior.
- **Accessibility** — see above, 6 tests, zero violations.
- **Regression**: full existing test suite, plus targeted Builds
  19–24 E2E regression (`crm.spec.ts`, `sales-pipeline.spec.ts`,
  `client-onboarding.spec.ts`, `customer-360.spec.ts` — the suites
  covering pages this build modified).

## Data honesty

Explicitly verified, not just claimed: Project/Support/Service health
are `NOT_MEASURABLE`, never fabricated as healthy or unhealthy; a
missing dimension never reduces the overall score (renormalization
against measurable weight only); a zero-measurable-components customer
gets `overallScore: null`, never `0`; no billing account never reads as
perfect payment health; no activity never gets fabricated as "recently
active" or silently treated as CRITICAL without being genuinely
measurable-and-stale; no contract end date never produces a fake
renewal date (renewal dates come from the real contract or an explicit
staff-entered date, never invented).

## Codex specialist work

- **DB Engineer** (background, workspace-write, scoped strictly to
  Prisma schema/migration/constraints/indexes/RLS/triggers): built the
  three-table migration matching spec. The process hung AFTER
  completing its real work (confirmed via direct psql inspection
  showing all tables/constraints/triggers/RLS policies already
  correctly in place) — killed and continued manually rather than
  waiting indefinitely, per this build's own "if Codex stalls, continue
  with Claude" principle.
- **Security Engineer** (read-only, adversarial): two findings, both
  fixed — the terminal-lifecycle CAS race (Medium) and the
  whitespace-only management-attention-reason DB constraint gap (Low).
  Every other attack category (RLS fail-closed, cross-company
  contract/deal forgery, forged `companyId`, permission-gate
  correctness, whether Client Success widens Customer 360's own
  permissions) came back clean.
- **Performance Engineer** (read-only): two findings, both fixed — the
  unbounded second half of the expiring-contracts-without-renewal query,
  and the missing `[organizationId, status, endDate]` index on
  `CrmContract` for that same new access pattern. Confirmed the
  portfolio has no `getCustomer360()`-per-customer N+1.
- E2E and accessibility were written directly (not delegated) — Codex's
  own sandbox cannot launch Chromium, the same constraint every prior
  build in this series has documented.

## Future Churn & Risk Engine (Roadmap Module 69) boundary

`evaluateChurnRisk()` is the explicit, documented seam Module 69 is
meant to replace or extend — not a preview or prototype of it. When
Module 69 exists, it can supersede this function's call site in
`getClientSuccessHealth()` without touching the health-score
composition, the renewal/expansion persistence, or the portfolio
aggregation, all of which are independent of the risk classification
itself.

## Future Customer Portal (Roadmap Module 20) boundary

Nothing in this build is customer-facing. `crm.client_success.read`/
`.manage` are both `PLATFORM`-scope, internal-staff-only permissions —
verified: a customer-organization member (no platform membership at
all) is denied both the portfolio and the Customer 360 Client Success
tab. Roadmap Module 20 has not started.

## Known limitations

- No health snapshot history — live-only, by design (see
  "Persistence"). If historical health trend charts are ever wanted,
  they need real durable scheduling infrastructure first, not a
  retrofit onto this build's live-compute model.
- No "renewal/contract expiring soon" push notification — no scheduler
  exists (see "Notifications"). The portfolio's own real-time view is
  the current substitute.
- The portfolio does not attempt to enumerate "every customer with
  unmeasurable health" or run per-customer churn classification at
  portfolio scale — neither has a bulk query shape that stays
  proportionate; the portfolio surfaces the same underlying real
  signals individually instead (see `crm-client-success-portfolio-service.ts`'s
  own top comment).
- Component scores are derived from a fixed 4-tier-to-number mapping,
  not independently continuous — documented as intentional (see "Score
  formula"), not a precision gap to close later without new source
  data.
