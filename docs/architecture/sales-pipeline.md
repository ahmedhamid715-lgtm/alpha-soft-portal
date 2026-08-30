# Sales Pipeline architecture

Build 20 implements Canonical Roadmap Module 14 — Sales Pipeline. Source
comments call this "Module 20" where they refer to the repository build
number; the roadmap capability remains Module 14.

## Purpose and boundary

Sales Pipeline is Alpha Page Rankers' own internal deal-tracking workspace:
pipelines, ordered stages, deals (opportunities), forecasting, and deal
history. It is built entirely on top of Build 19's CRM — it does not clone,
duplicate, or reinterpret any CRM entity, and it is not sales quotas,
commissions, rep-performance analytics, proposal generation, contracts,
e-signatures, client onboarding, a workflow-automation engine, generic
approvals, a generic reporting engine, Customer 360, or an AI sales agent.

The implementation follows the same layering CRM already established:

1. Server Components render platform-admin Sales Pipeline routes.
2. Client forms/board interactions call thin Server Actions in the CRM
   route tree (`src/app/(protected)/admin/crm/actions.ts`).
3. Services parse input, resolve authorization, enforce lifecycle and
   relationship rules, and open a tenant-scoped transaction.
4. Repositories contain Prisma persistence and bounded query shapes.
5. PostgreSQL RLS and relationship-integrity triggers provide the final
   data isolation layer through the restricted application role.

## Relationship to Build 19 CRM

Sales Pipeline reuses CRM as the single source of truth for customer-facing
data:

- A deal's `companyId` references an existing `CrmCompany` (required).
- A deal's optional `primaryContactId` references an existing `CrmContact`,
  validated to belong to the same company.
- A deal's optional `sourceLeadId` references an existing `CrmLead`,
  validated to belong to the same company.
- Converting a lead to a deal (`convertLeadToDeal()`) requires the lead be
  `QUALIFIED`, transitions it to `CONVERTED` via CRM's own
  `crmLeadRepository.changeStatus()`, and logs the same `CrmActivity`
  status-change record CRM's own lead lifecycle already produces — all
  inside one transaction with the new deal's creation, so the lead
  transition and the deal's existence are atomic.

No `SalesCompany`, `SalesContact`, or duplicate lead/activity system exists.
Deal-level notes live in `CrmDealHistory`, not `CrmActivity` — see "Deal
history" below for why that boundary was drawn instead of extending CRM's
existing exactly-one-parent activity model to a fourth parent type.

Winning a deal does **not** create an Organization, an authenticated User, a
customer tenant, or a billing account. That handoff belongs to Roadmap
Module 17 — Client Onboarding — and is explicitly out of scope here.

## Data model

`CrmPipeline` is a named, ordered collection of stages, owned by one
organization. `status` is `ACTIVE`/`ARCHIVED`. `isDefault` marks the
pipeline used when a caller doesn't specify one; at most one default
pipeline may exist per organization, enforced by a hand-written partial
unique index (`crm_pipelines_one_default_per_org`) since Prisma's `@@unique`
cannot express a `WHERE` clause. Multiple pipelines are supported —
nothing hard-codes a single global pipeline or a fixed stage set.

`CrmPipelineStage` belongs to one pipeline. Ordering is a gap-based integer
`sortOrder` (seeded in increments of 1000): an ordinary single-position
reorder computes a midpoint between two neighbors; a full renumber (also
increments of 1000, over one pipeline's own small stage count only) is a
rare fallback once a gap is exhausted. Stage names are unique within a
pipeline. `status` is `ACTIVE`/`ARCHIVED` — archived stages are excluded
from new deal creation, stage moves, and win/lose targets (see
"Lifecycle"). `isWon`/`isLost` are **descriptive board-display hints only** —
see "Lifecycle" for why `CrmDeal.status` is the sole authority. An optional
`defaultProbability` seeds a deal's probability when it enters that stage
without the caller specifying one.

`CrmDeal` is the canonical internal term for what other systems might call
an "opportunity" — the codebase's own `Crm*` model-name namespace and this
module's own "do not create a duplicate parallel-naming system" instruction
both pointed the same direction. Every deal has an owning `pipelineId` and
`stageId` (validated to belong to that pipeline), a required `companyId`,
optional `primaryContactId`/`sourceLeadId`/`assignedToUserId`, a title,
money fields (below), an optional `probability`, an optional
`expectedCloseDate`, a `status` (`OPEN`/`WON`/`LOST`), and won/lost detail
fields (`lossReason`, `wonAt`, `lostAt`). Fields stay deliberately narrow —
no custom-field extension point, no multi-contact roster (one
`primaryContactId` only), matching the "don't prematurely add dozens of
fields" instruction.

`CrmDealHistory` is an append-only business chronology, distinct from the
centralized security/compliance audit log (see "Audit and notifications").
It records `CREATED`, `STAGE_CHANGED`, `VALUE_CHANGED`,
`PROBABILITY_CHANGED`, `EXPECTED_CLOSE_DATE_CHANGED`, `OWNER_CHANGED`,
`WON`, `LOST`, `REOPENED`, and the one user-authorable type, `NOTE`. Entries
have no `updatedAt` — they are immutable once written (no UPDATE/DELETE RLS
policy; matching REVOKEs at the grant layer). `metadata` holds small,
bounded field-level detail (e.g. `{"from":"NEW","to":"CONTACTED"}`), never a
full row dump.

## Deal ↔ CRM relationship reuse and Deal history vs. CRM activities

Two real options existed for deal-level notes: extend `CrmActivity`'s
existing exactly-one-of-3-parent model to a fourth parent (`dealId`), or
build a separate deal-scoped history model. This module chose the latter,
deliberately, to avoid touching Build 19's already-proven, already-tested
activity CHECK/trigger/RLS infrastructure at all. `CrmDealHistory` is
wholly self-contained; CRM's own activity timeline is untouched by this
build.

## Money

Sales Pipeline reuses the platform's existing money convention
(`src/lib/utils/money.ts`, established by the Billing modules) exactly:
`valueMinorUnits` is an integer (never a JavaScript float), `currency` is a
free-form ISO 4217 string (never an enum, matching
`Organization.currency`/`BillingAccount.currency`), validated by a shared
`currencyCodeSchema` (three-letter regex, normalized to uppercase — added
after Codex's security review found a bare `.length(3)` check accepted
malformed strings that crash `Intl.NumberFormat`). `value_minor_units >= 0`
and `probability BETWEEN 0 AND 100` are enforced by database CHECK
constraints, not just application validation. Sales Pipeline does not write
to invoices, payments, or subscriptions — Billing remains authoritative for
all of that.

## Probability

Probability is an **integer percentage, 0–100** (never a decimal fraction),
enforced structurally by both a Zod range check and a database CHECK
constraint. A stage's `defaultProbability` seeds a deal's own probability
when it enters that stage without an explicit value; the deal's own
`probability` field can then be overridden independently and does not
re-sync to the stage afterward.

## Forecasting

All forecast numbers are deterministic aggregation over real deal rows —
never a prediction, and never described as "AI forecasting" (that
terminology is reserved for a future, distinct roadmap item):

- **Pipeline value** — `SUM(valueMinorUnits)` over OPEN deals.
- **Weighted forecast** — `SUM(valueMinorUnits × probability / 100)` over
  OPEN deals that have a probability set. Deals with no probability are
  excluded (never assumed 0 or 100) and separately counted so the UI can
  say so honestly rather than silently omitting them.
- **Expected closing** — `SUM(valueMinorUnits)` for OPEN deals whose
  `expectedCloseDate` falls inside a window (default: the current UTC
  calendar month). Deals with no close date are excluded and separately
  counted, for the same honesty reason.
- **Won value** — `SUM(valueMinorUnits)` for deals `WON` with `wonAt`
  inside a window (default: the current UTC calendar month).

Every aggregate is **grouped by currency**, never summed across
currencies — this codebase has no authoritative FX conversion, so
multi-currency pipelines report one total per currency rather than a
fabricated blended number. Three of the four aggregates use Prisma's
`groupBy()`; the weighted forecast uses a raw, parameterized
`$queryRaw`/`Prisma.sql` query because `groupBy()` cannot express a
computed-column `SUM(value × probability)`. Both multiplication operands
are cast to `::bigint` before multiplying (a Postgres `integer × integer`
computation overflows for a real, legitimately-sized deal at high value —
found by Codex's own security review and fixed before this build shipped).
All four aggregates run in Postgres; none loads deal rows into Node to sum
in JavaScript.

## Lifecycle

`CrmDeal.status` (`OPEN`/`WON`/`LOST`) is the **sole lifecycle authority**.
`CrmPipelineStage.isWon`/`isLost` are descriptive board-display hints only,
enforced structurally: `moveDealStage()` rejects any target stage flagged
`isWon`/`isLost`; only `winDeal()`/`loseDeal()` may enter one of those two
terminal states, and only `reopenDeal()` may exit one, back to `OPEN` (an
ordinary, non-terminal stage). A deal cannot move between two ordinary
stages while terminal, and cannot skip straight from `WON` to `LOST` or vice
versa without an explicit reopen first. `lossReason` is required to record a
loss; `wonAt`/`lostAt` are set exactly once per transition and cleared by
`reopenDeal()`. Every lifecycle transition (`moveStage`/`win`/`lose`/
`reopen`) is a real compare-and-swap — a guarded `updateMany()` keyed on the
expected prior state, `count === 0` meaning "lost the race," surfaced as a
`ConflictError` rather than a silent overwrite. This is the same CAS pattern
Build 19 established for `crmLeadRepository.changeStatus()` and
`crmTaskRepository.complete()`/`cancel()`.

Archived pipelines and stages are rejected as operational targets for deal
creation, stage moves, and win/lose — including winning directly into an
archived `isWon` stage — found by Codex's own security review and fixed via
`assertOwnedPipelineAndStage()`'s `requireActivePipeline`/
`requireActiveStage` options (default `true`).

## Deal ↔ owner assignment boundary

A deal's `assignedToUserId` must be an active platform-organization staff
member (reusing `crm-shared.ts`'s existing `assertPlatformStaffMember()`).
This is deliberately the full extent of "assignment" in Build 20. Sales
quotas, territories, commissions, assignment hierarchy, and a
rep-performance engine belong to Roadmap Module 15 — Sales Team Management —
which was **not started** by this build.

## Authorization

Two new permissions, both `PLATFORM` scope, mirroring `crm.read`/
`crm.manage`'s own placement:

- `crm.pipeline.read` — view pipelines, stages, deals, and forecasts.
  Granted to platform owner, platform admin, and support admin.
- `crm.pipeline.manage` — create/edit/archive pipelines and stages; create
  and mutate deals (lifecycle, ownership, notes). Granted to platform owner
  and platform admin only.

Customer-organization roles and support agents receive neither permission.
Every service invocation re-resolves the authenticated session, active
platform membership, role, and permission — the same defense-in-depth
convention CRM already established; hiding a UI control is never the
authorization boundary. Converting a lead to a deal requires **both**
`crm.manage` and `crm.pipeline.manage`, since it mutates a CRM lead and
creates a Sales Pipeline deal in the same transaction.

## Row-level security

All four new tables enable and force RLS, using the same restricted
`alpha_os_app` role Build 19 already established. `crm_pipelines`,
`crm_pipeline_stages`, and `crm_deals` have SELECT/INSERT/UPDATE policies
requiring `organization_id = tenant_current_organization_id() AND
tenant_is_platform_context()`. `crm_deal_history` has SELECT/INSERT only —
no UPDATE, no DELETE, matched by REVOKE grants for defense in depth. No
table in this module has a DELETE policy.

A new `crm_pipeline_enforce_relationship_integrity()` trigger function
(SECURITY INVOKER, deliberately its own separate function and migration
rather than a modification to Build 19's own
`crm_enforce_relationship_integrity()`) closes the nested cross-tenant
association gap a single-column FK cannot: stage↔pipeline organization
match, deal↔pipeline organization match, deal's `stageId` actually belongs
to deal's `pipelineId`, deal↔company organization match, deal's
`primaryContactId` belongs to both the same organization and the same
company, deal's `sourceLeadId` belongs to both the same organization and the
same company, and deal_history↔deal organization match. Build 19 already
found a real vulnerability class in exactly this shape (nested cross-tenant
FK relationships); this build does not regress it — the restricted-role RLS
suite proves all of the above directly, plus fail-closed (no context → zero
rows), two-tenant isolation, forgotten-WHERE isolation, cross-tenant
mutation denial, the partial-unique-index constraint, and both CHECK
constraints.

## Concurrency

Real races are protected at the database layer, not assumed away:
simultaneous stage transitions, a WON-vs-LOST race, a duplicate
win/lose/reopen action, and stage-reorder collisions are all guarded by the
CAS `updateMany()` pattern described under "Lifecycle." A lost race
surfaces as a `ConflictError`, never a silent overwrite.

## Audit and notifications

Sales Pipeline reuses the existing `CRM` audit category (no new category)
for: pipeline created/archived, deal created, deal owner changed, deal
won/lost/reopened. Routine value/probability/close-date edits and deal notes
are **not** separately audited — that is `CrmDealHistory`'s job, matching
the "AuditEvent is security/compliance, Deal History is business
chronology" split. The existing `CRM_ACTIVITY` notification category gains
one new template, `crm.deal.assigned` — an exact mirror of Build 19's own
`crm.task.assigned` — delivered only on deal assignment/ownership change,
in-app and optionally by email to a validated active platform-staff
assignee. Stage moves do not notify; this module does not implement
workflow automation.

## UI

`/admin/crm/pipeline` is the board: a pipeline selector, stage columns, deal
cards, a forecast summary, and a "New deal" form (management-permission
gated). `/admin/crm/deals/[id]` is the deal detail page: edit form, owner
control, lifecycle controls (move/win/lose/reopen), note form, and history.
`/admin/crm/settings`'s existing page gained an independently-gated "Sales
pipelines" section (pipeline/stage CRUD, up/down stage reorder buttons) —
CRM's pre-existing lead-sources/custom-fields sections are unchanged.
`/admin/crm`'s dashboard gained a 5th "Open deals" stat card and a "Sales
pipeline →" link; its pre-existing lead-status-counts section was relabeled
"Lead pipeline" to disambiguate it from this module's own real Sales
Pipeline. A qualified lead's detail page gained a "Convert to deal" section,
visible only to holders of both `crm.manage` and `crm.pipeline.manage`. No
new visual language was introduced — every surface reuses the existing
design system's components, spacing, and color tokens.

### Drag-and-drop and its accessible alternative

No new dependency was added for drag-and-drop (`package.json` has none —
confirmed by direct inspection before building). Native HTML5 drag-and-drop
(`draggable`, `onDragStart`/`onDragOver`/`onDrop`) is layered as a pure
progressive enhancement on top of an **always-visible, keyboard-operable**
`<Select>` "Move to a different stage" control present on every deal card —
that Select is the true primary interaction the accessibility requirement
calls for, not a hidden fallback. Both paths call the identical server
action. The server independently validates every stage transition
(ownership, pipeline match, active status, terminal-state rules); a forged
target stage ID, a cross-pipeline move, or a cross-tenant move is rejected
regardless of which UI path produced the request. Neither path uses
optimistic UI — every mutation awaits the real server result, then either
shows an error (`sonner` toast for drag-drop, an inline `Alert` for forms)
or `router.refresh()`s to the confirmed state; this avoids the classic
optimistic-UI reconciliation bug surface and matches this codebase's
existing pattern on every other page.

## Security

Codex's Phase 5 security review (read-only, adversarial) found four real
issues, all fixed and covered by a dedicated regression suite
(`tests/integration/db/sales-pipeline-security-fixes.test.ts`, 7 tests):

1. **MEDIUM** — archived pipelines/stages remained valid operational
   targets for deal creation, stage moves, and win/lose (including winning
   directly into an archived `isWon` stage). Fixed via
   `assertOwnedPipelineAndStage()`'s `requireActivePipeline`/
   `requireActiveStage` options and filtering win/lose's own stage lookups
   to `status: "ACTIVE"`.
2. **LOW** — `updateStage()` validated only the current request's own
   `isWon`/`isLost` fields, not merged with existing state, allowing a
   one-flag-at-a-time flip to produce a stage that's simultaneously Won and
   Lost. Fixed by computing the merged next state before validating.
3. **LOW** — the weighted-forecast raw SQL multiplied in 32-bit Postgres
   `integer` context, overflowing for a legitimate high-value deal. Fixed
   with `::bigint` casts on both operands.
4. **LOW** — `currency: z.string().length(3)` accepted malformed non-alpha
   strings that crash `Intl.NumberFormat`. Fixed with a shared
   `currencyCodeSchema`.

Server inputs are Zod-parsed with unknown fields stripped, preventing mass
assignment of organization, lifecycle, or actor fields. All supplied UUID
relationships (pipeline, stage, company, contact, lead, assignee) are
resolved inside the authorized tenant-scoped transaction; missing or
cross-tenant resources fail safely as not-found/validation errors, never a
silent cross-tenant read or write.

## Performance

Codex's Phase 8 review (read-only) found 7 real issues (1 HIGH, 2 MEDIUM, 4
LOW). Confirmed non-findings worth stating plainly: the board fetches one
selected pipeline (never every pipeline's deals), there is no per-deal
company/contact/assignee N+1 (relations are batched, not looped), every
list this module returns is bounded (`listOpenForPipeline()` caps at 500,
deal history paginates at a default of 25/max 100, pipeline and stage
settings lists cap at 200), and every forecast aggregate runs in Postgres,
never in Node.

Fixed as part of this build (all confirmed low-risk, confined to Sales
Pipeline's own files):

- **MEDIUM** — the settings page's stage list had a real per-pipeline N+1
  (`Promise.all(pipelines.map(p => listStagesForPipeline(...)))`, each with
  its own authorization/tenant-context fan-out). Fixed with a new batched
  repository method (`crmPipelineStageRepository.listForPipelines()`) and
  service wrapper (`listStagesForPipelines()`) — one query, one auth
  resolution, for however many pipelines an organization has configured.
- **MEDIUM** — the board's highest-traffic query
  (`listOpenForPipeline()`: `organization_id + pipeline_id + status = OPEN`,
  ordered by `created_at`) had no compound index fully matching that
  predicate and order. Added
  `crm_deals_organization_id_pipeline_id_status_created_at_idx`.
- **LOW** — the board page called `getDefaultPipeline()` in addition to
  `listPipelines()`, re-running an identical organization/ACTIVE query
  (and its own full auth/tenant fan-out) that the page had just issued.
  Fixed by deriving the default pipeline directly from the already-loaded
  `pipelines` array.
- **LOW** — `listDeals()`'s unfiltered default path (`organization_id`,
  ordered by `created_at`) lacked the tenant-plus-created-time index Build
  19 already gives `crm_leads`. Added
  `crm_deals_organization_id_created_at_idx`.
- **LOW** — `wonValueByCurrency()`'s window query (`status = 'WON' AND
  won_at BETWEEN ...`) had no index containing `won_at`. Added a partial
  index, `crm_deals_organization_id_won_at_idx` (`WHERE status = 'WON' AND
  won_at IS NOT NULL` — indexing the ~2/3 of rows where `won_at` is always
  NULL would be pure overhead), hand-written directly in the migration
  since Prisma's `@@index` cannot express a partial index (the same
  limitation already noted for `crm_pipelines_one_default_per_org`).

**Not fixed — documented as a known limitation instead (see below):** the
HIGH finding (every page-level service call independently re-resolves
authorization and opens its own tenant transaction, so the board and deal
detail pages each execute on the order of a hundred or more SQL statements
even with a tiny dataset) and two LOW findings (the forecast summary's six
aggregate queries share one interactive-transaction connection, so
`Promise.all` does not make them truly concurrent; the CAS lifecycle
methods perform an `updateMany()` + separate `findUnique()` refetch instead
of a single `UPDATE ... RETURNING`). All three require touching shared,
platform-wide authorization/session infrastructure
(`session-guard.ts`, `authorization/context.ts`) or a broader
Prisma-client-capability change outside every directory this build owns —
fixing them properly deserves a dedicated, platform-wide task with its own
review, not a side-fix folded into a Sales-Pipeline-scoped commit. Codex's
own read-only review reached the same conclusion for the transaction-based
finding: opening six separate tenant transactions merely to force true
concurrency would add more overhead than it saves at this data scale.

## Accessibility

Sales Pipeline reuses the shared design system, semantic labels, and the
same responsive/keyboard-operable patterns CRM already established.
Production Playwright + axe-core coverage
(`tests/e2e/sales-pipeline-accessibility.spec.ts`, 18 tests) scans the
board, deal detail, and settings pages in light and dark themes; the
board and deal detail across desktop/tablet/mobile; the deal card's own
open stage-select, a fresh deal's loss-reason form, a dirty new-stage form,
and a brand-new empty pipeline's board view; and confirms ordinary keyboard
tab progression reaches multiple real interactive elements without a focus
trap.

One real, **pre-existing, platform-wide** defect surfaced during this
pass — not a Build 20 regression. Opening any Radix `Select` anywhere in
this app (not just Sales Pipeline) applies `aria-hidden` to the entire
`sidebar-wrapper` app shell, which contains `<main>` and the page's own
`<h1>`, because the shared `Select` wrapper runs in Radix's default
`modal` mode. That cascades into four axe rule violations
(`aria-hidden-focus`, `landmark-one-main`, `page-has-heading-one`,
`region`) whenever a scan runs while a Select's listbox is left open.
Reproduced independently on an unrelated, already-shipped Build 19 page
(`/admin/crm/settings`, opening any of its pre-existing selects) with the
identical four violations, confirming the root cause lives in
`src/components/ui/select.tsx`/`sidebar.tsx`, both outside every directory
this build owns. It is excluded, with a full inline rationale, only in the
one Sales Pipeline test that deliberately leaves a Select open — every
other scan in the suite runs with the full, unmodified axe rule set. The
likely eventual fix (`modal={false}` on the shared `Select` root, or an
equivalent adjustment) belongs to its own dedicated, platform-wide
accessibility task, not this build.

## Testing

- **Unit** (Vitest): stage ordering/gap-renumber logic, lifecycle
  transition rules, probability validation, forecast formula composition,
  value/currency validation, won/lost behavior — alongside the full
  existing suite (no Build 19 test was weakened).
- **Integration** (`tests/integration/db/sales-pipeline-security-fixes.test.ts`,
  7 tests): the four security fixes above, exercised against real services
  and a real database.
- **Restricted-role RLS**
  (`tests/integration/db/sales-pipeline-rls.test.ts`, 22 tests): fail-closed,
  two-tenant isolation, forgotten-WHERE protection, the partial-unique-index
  constraint, both CHECK constraints, and the full relationship-integrity
  trigger matrix (cross-pipeline stage rejection, wrong-company contact
  rejection, wrong-company source-lead rejection, and a positive-control
  legitimate deal).
- **E2E** (`tests/e2e/sales-pipeline.spec.ts`, 9 tests, real `next build` +
  `next start`): access control and discoverability across roles, the full
  interactive deal lifecycle (create, move via the accessible select, edit,
  reassign, win, reopen, lose with a required reason, note logging, and a
  real system-generated history entry), lead-to-deal conversion, pipeline
  and stage settings (create, reorder, archive), forecast widgets, direct
  access to a nonexistent deal, and mobile/tablet usability.
- **Accessibility** (`tests/e2e/sales-pipeline-accessibility.spec.ts`, 18
  tests): see "Accessibility" above.

All of the above pass cleanly; the machine this build ran on has a
pre-existing, documented memory-pressure condition (also noted in Build
19's own accessibility suite) that can make a single long sequential
Playwright run flaky on login timing alone, never on selector or
application logic — mitigated, as Build 19 already established, by running
in smaller `--grep`-scoped batches with a fresh production server between
batches.

## Known limitations

- Sales quotas, commissions, sales leaderboards, and rep-performance
  analytics are not implemented (Roadmap Module 15's own scope).
- Proposal generation, contracts, and e-signatures are not implemented.
- Winning a deal never provisions an Organization, User, or billing
  account (Roadmap Module 17's own scope).
- No workflow-automation engine, generic approvals, or generic reporting
  engine exists here.
- Forecasting is deterministic arithmetic only — there is no AI-assisted
  or predictive forecasting, and none is implied by the "forecast"
  terminology used throughout this module.
- No external CRM synchronization and no customer-portal exposure of any
  Sales Pipeline data — every route in this module is platform-staff only.
- A deal has exactly one primary contact, not a multi-contact roster —
  a deliberate simplification, revisit only if a real workflow needs more.
- There is no database-level `CHECK (NOT (is_won AND is_lost))` on
  `crm_pipeline_stages` — the merged-state validation described under
  "Security" finding 2 is enforced at the service layer only. Left as an
  app-layer-only defense deliberately, since the service layer is the sole
  write path for stage `isWon`/`isLost` and adding a redundant DB
  constraint was judged unnecessary complexity for this build; revisit if
  a future direct-SQL write path is ever introduced.
- The request-level authorization/tenant-context fan-out described under
  "Performance," and the shared Radix `Select` accessibility defect
  described under "Accessibility," are both real, confirmed, and
  **pre-existing/platform-wide** rather than Sales-Pipeline-specific —
  intentionally left for a dedicated future task rather than folded into
  this build's own commit.

## Future compatibility

Roadmap Module 15 (Sales Team Management) can extend deal assignment
(quotas, territories, hierarchy, rep performance) without altering this
module's own data model — `assignedToUserId` already exists as the
integration point. Roadmap Module 17 (Client Onboarding) can consume a
`WON` deal as its own trigger without this module needing to know anything
about Organizations, Users, or billing. Any future module introducing
deal-level custom fields, additional contacts, or additional pipelines
should extend the existing `CrmDeal`/`CrmPipeline` models rather than
introduce a parallel system, matching this build's own "extend, don't
rebuild" relationship to Build 19.
