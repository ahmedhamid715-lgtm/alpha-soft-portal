# Sales Team Management architecture

Build 21 implements Canonical Roadmap Module 15 — Sales Team Management. Source
comments call this "Module 21" where they refer to the repository build
number; the roadmap capability remains Module 15.

## Purpose and boundary

Sales Team Management makes Alpha OS useful for managing Alpha Page Rankers'
own sales team: rep rosters, targets, quotas, activity tracking, closed
deals, conversion rates, and a deterministic leaderboard. It is built
entirely on top of Build 19's CRM and Build 20's Sales Pipeline — it stores
no duplicate identity, deal, lead, or activity data. It is not full Employee
Management, payroll, workforce scheduling, generic HR, a commission
accounting/payout engine, proposals/contracts, customer onboarding, a
generic reporting engine, or an AI sales agent.

The implementation follows the same layering CRM/Sales Pipeline already
established:

1. Server Components render platform-admin Sales Team routes.
2. Client forms/controls call thin Server Actions in the CRM route tree
   (`src/app/(protected)/admin/crm/actions.ts`).
3. Services parse input, resolve authorization, enforce business rules, and
   open a tenant-scoped transaction.
4. Repositories contain Prisma persistence and bounded query shapes.
5. PostgreSQL RLS and relationship-integrity triggers provide the final data
   isolation layer through the restricted application role.

## Sales Rep identity

A Sales Rep is never a second identity. `CrmSalesTeamMember` always
references an existing `User` — the same identity Auth.js/RBAC already
authenticate and authorize. Not every platform-staff member is a sales rep:
a `CrmSalesTeamMember` row's mere existence (and `status`) is the explicit
opt-in this module requires. Removal sets `status = INACTIVE` and `leftAt`;
it never hard-deletes, because past goals and performance attribution keep
referencing the same row. A rep who leaves and later rejoins gets a **new**
row, not a reactivated one — the old row (and everything that references it)
stays exactly as it was, which is also how the database enforces "at most
one ACTIVE row per user" without conflicting with historical rows.

## Sales team model

Alpha OS does **not** have a separate `SalesTeam` grouping entity. This
platform has exactly one internal sales function, for one platform
organization — inventing a multi-team grouping table would be hierarchy for
its own sake, which the master prompt explicitly warns against. The entire
"team" concept is a single, optional, self-referencing `managerId` column on
`CrmSalesTeamMember` (a rep's manager is itself another
`CrmSalesTeamMember` — the manager must be an explicit sales-team
participant too, not merely any platform user). This is the narrowest
mechanism that still supports rep attribution, a manager's own "direct
reports" view, targets/quotas, and leaderboard/performance reporting — the
four things this module actually needs to support.

## Targets vs. quotas

One unified `CrmSalesGoal` model, not two near-duplicate tables — the two
concepts differ only in **meaning** (`kind: TARGET` = a desired operational
metric, informal; `kind: QUOTA` = a formal performance threshold), not in
shape. `metric` (`REVENUE_WON` / `DEALS_WON` / `CALLS_LOGGED` /
`APPOINTMENTS_LOGGED` / `LEAD_CONVERSION_RATE`) determines which of three
value columns is populated:

- `REVENUE_WON` — `valueMinorUnits` + `currency` (same integer-minor-units,
  free-string-ISO-4217 convention as `CrmDeal`/Billing).
- `DEALS_WON` / `CALLS_LOGGED` / `APPOINTMENTS_LOGGED` — `valueCount`, a
  plain integer.
- `LEAD_CONVERSION_RATE` — `valuePercent`, an integer 0–100.

A database CHECK constraint enforces the exact truth table (exactly the
right column set is non-null for the goal's own metric); the same rule is
also validated in the application layer (`createGoal()`'s own `superRefine`)
so a malformed request fails with a clean error before ever reaching the
database.

Goals are **immutable once created**, except `status`
(`ACTIVE -> ARCHIVED`, via `archiveGoal()`). A mistaken value or period is
corrected by archiving and creating a replacement, never an in-place edit —
this sidesteps the whole "concurrent update" bug class the master prompt's
own Concurrency section calls out (overlapping quota creation, target
updates) without inventing an update-locking scheme for a low-frequency
settings-style action. It also keeps the centralized audit log's
`crm.sales_team.goal_created`/`goal_archived` entries a complete, honest
history without a second goal-history table.

`salesTeamMemberId` is nullable: null means an **organization-wide** goal
(visible and manageable from the Sales Team overview page, alongside the
roster); non-null scopes it to one rep (visible/manageable from that rep's
own detail page).

## Period semantics

Every goal has a concrete, persisted `[periodStart, periodEnd)` — half-open,
computed once at creation time, never re-derived at read time. This reuses
`FinancialPeriod`/`resolvePeriod()`/`customPeriod()` from
`src/lib/billing/reporting/period.ts` (Module 15 — Billing Intelligence's
own primitive) directly, the same genuinely domain-agnostic reuse
`ai-observability-service.ts` already established for a different, unrelated
module. Every named period (`current_month`, `previous_quarter`, ...) is
supported; `customPeriod()` accepts an explicit range for anything else.
Every Sales Team period is anchored to **UTC** — this module, like AI
observability, has no single organization-local timezone to anchor to (it
is one platform-wide internal function); see `period.ts`'s own doc comment
for the full reasoning.

Overlapping records are **prevented at the database level**, not merely
checked in application code: a hand-written `EXCLUDE USING gist` constraint
(`crm_sales_goals_no_overlapping_active_period`) forbids two ACTIVE goals
for the same `(organization, rep-or-org-wide, kind, metric)` scope from
having overlapping periods. `sales_team_member_id` is coalesced to a fixed
sentinel UUID inside that constraint specifically so two organization-wide
goals collide with each other too (GiST/btree equality treats two NULLs as
non-matching by default, which would otherwise let unlimited overlapping
org-wide goals through). The service layer also pre-checks for a clean
`ConflictError` before ever attempting the insert; the database constraint
is the actual, unconditional guarantee.

## Activity tracking, calls, and appointments

No new activity/notes table. Calls and appointments both reuse Build 19's
existing `CrmActivity` model — `CALL` and `MEETING` are two of its five
existing types, already logged by real CRM usage. A "call" for performance
purposes is a `CALL`-typed activity logged in the period; an "appointment"
is a `MEETING`-typed activity logged in the period. There is no separate
"scheduled vs. completed" appointment status: `CrmActivity` is always
logged retrospectively (it has no future/scheduled state in this app, which
has no calendar/scheduling feature), so a logged `MEETING` activity's mere
existence already means the meeting happened. No telephony integration
(Twilio, dialer, recording, transcription) exists or is implied — this
module measures sales performance, not phone infrastructure.

## Closed deals and historical attribution

Closed-deal counting is built directly on `CrmDeal`'s own lifecycle
(Build 20): Closed Won is `status = WON`, Closed Lost is `status = LOST`.
No second results table exists.

**Attribution is the single most important design decision in this
module**, because `CrmDeal.assignedToUserId` is mutable — a deal can be
reassigned at any time, including after it closes (`changeDealOwner()` has
no status guard). Naively querying "deals WHERE `assignedToUserId` = rep AND
`wonAt` in period" would make a period's own historical numbers silently
change whenever a closed deal is later reassigned — exactly what the master
prompt's own "Time / Attribution" section warns against.

The fix uses data Build 20 already made immutable: `CrmDealHistory`'s own
`WON`/`LOST` entries record `actorUserId` — whoever actually performed the
close — at the exact moment it happened, and that table has no UPDATE
policy at all (append-only, enforced at the database). **Won/lost deal
count and revenue attribution use this immutable `actorUserId`, never the
deal's own current `assignedToUserId`.** This is not just historically
stable, it is arguably the more honest metric anyway: a rep who inherits and
closes someone else's deal deserves credit for closing it. Call/appointment
attribution uses `CrmActivity.actorUserId`, which is equally immutable (no
UPDATE/DELETE policy, Build 19). Both required **zero new schema** — pure
reuse of already-proven immutable data.

Two metrics are deliberately **not** immutable-attribution:

- **Open pipeline value / weighted forecast** (shown as period-independent
  context on a rep's own detail page) use the deal's current
  `assignedToUserId` — correctly so, since an open deal's own forecast
  numbers are supposed to move with reassignment; this is current-state
  data, not history.
- **Lead conversion rate** uses the lead's current `assignedToUserId`. This
  is a documented, deliberate simplification: leads carry no revenue
  stakes the way deals do, and building a second immutable-attribution
  mechanism for a lower-stakes metric was judged unnecessary complexity for
  this build. Revisit if lead reassignment-after-conversion becomes a real
  operational pattern.

## Conversion rates

**Lead → Deal conversion (cohort, per rep, per period):**
`converted leads / eligible leads`, where "eligible" = leads assigned to
that rep with `createdAt` inside the period (an intake cohort), and
"converted" = the subset of that same cohort that has reached `CONVERTED`
status **as of now** (not necessarily converted within the same period).
This is an honest, standard sales-ops cohort measure — it will understate
for a very recent period, since some leads in that cohort are still in
progress. That lag is a real, inherent property of cohort measurement, not
a bug, and is documented rather than hidden. Zero-denominator (no leads
created in the period) renders `null` — "Not measurable," never a fabricated
`0%`.

**Deal win rate (per rep, per period):** `won deals / (won deals + lost
deals)`, both by the immutable close-actor (see above), both with
`occurredAt` inside the period. Zero-denominator (no deals closed) renders
`null`, never `0%`.

**Deliberately not built:** an "appointment → won deal" conversion rate,
explicitly evaluated and rejected — `CrmActivity`'s own schema has no
structural link from one specific meeting to one specific deal's eventual
outcome, and fabricating one would mean inventing a relationship Build 20
doesn't have. Building it honestly would require new schema Build 21 was
not asked to add; reported here as a real, deliberate scope decision, not
an oversight.

## Leaderboard

Deterministic ranking (`getSalesLeaderboard()`) over five metrics: revenue
won, deals won, win rate, calls logged, appointments logged — all computed
via a single grouped-by-actor pass over `getSalesPerformanceSummary()`'s own
data, never one query per rep. `REVENUE_WON` ranks by the single largest
currency total a rep has (a disclosed simplification: a multi-currency
rep's own smaller-currency totals are not blended into one fabricated
number — see "Money" below). Ties break deterministically by the rep's own
display name, ascending — never arbitrary database row order. A `null`
metric value (e.g. no closed deals this period) sorts last and renders "Not
measurable," never a fabricated last-place ranking value.

## Performance metrics (user-facing)

No composite, weighted "performance score" is computed — the master
prompt's own explicit instruction against a fabricated proprietary metric.
The rep detail page shows transparent individual metrics instead: won
value/count, win rate, calls, appointments, lead conversion, open pipeline
value, weighted pipeline value, and goal attainment (see below). Every one
of these is an honestly-labeled real number or "Not measurable"/"$0" (a
genuine zero, e.g. zero won deals — distinct from "Not measurable," which
only applies when a ratio's own denominator is zero).

**Goal attainment** (`getGoalAttainment()`): actual value achieved during a
specific goal's **own stored period** (never the caller's arbitrary
reporting period, since a goal's attainment is only meaningful against its
own window) divided by the goal's own target value, as a percentage.
Attainment renders `null` ("Not measurable") only if the goal's own target
is zero (defensive; validation already prevents a genuinely zero target for
count/percent metrics) — a real `0%` actual-vs-target is a valid, honest
result and is shown as `0%`, not "Not measurable."

## Commission boundary (Module 43)

Roadmap Module 43 is the dedicated, authoritative Commissions module —
commission rules, calculation, approval, and payout tracking all belong
there. Build 21 deliberately stores **zero** commission-related fields: no
rate, no computed earned amount, no payout status, anywhere in this schema.
The only commission-adjacent thing this build offers is **visibility
context that already exists for other reasons** — a rep's own "won value
this period" (already computed for the leaderboard/performance cards) is
shown as-is; nowhere does the UI claim it is a commission figure, and
nowhere is a percentage or payout amount fabricated. There is no
"Not configured" commission widget rendered at all in this build — that
would imply a feature exists that doesn't; the integration boundary is
simply that the immutable close-actor attribution this module already
computes (`CrmDealHistory`'s own `actorUserId` on WON/LOST entries) is the
natural, ready-made "who gets credit for this deal" primitive Module 43 can
read directly when it's built, with no schema migration needed on this
module's side.

## Tenant ownership, authorization, and RLS

Both new tables (`crm_sales_team_members`, `crm_sales_goals`) are owned
exclusively by Alpha Page Rankers' one platform organization — never a
customer organization, mirroring CRM/Sales Pipeline's own invariant exactly.

Two new permissions, both `PLATFORM` scope, in the same `crm.*`
sub-resource family as `crm.pipeline.*` (not a new top-level namespace):

- `crm.sales_team.read` — view roster, performance, leaderboard, and
  targets/quotas. Granted to platform owner, platform admin, and support
  admin.
- `crm.sales_team.manage` — add/remove reps, change manager assignments,
  create/archive targets and quotas. Granted to platform owner and platform
  admin only.

Every service function independently re-resolves the authenticated session
and re-checks the relevant permission — the same defense-in-depth
convention every prior CRM extension establishes; a hidden UI control is
never the authorization boundary. Server Actions in `actions.ts` are thin
wrappers with zero authorization logic of their own; a direct, forged call
to `createSalesGoalAction`/`addSalesTeamMemberAction`/etc. by a
`crm.sales_team.read`-only (not `.manage`) caller is rejected by the
service layer's own `resolveCrmScope("crm.sales_team.manage")` call, not by
anything client-side.

RLS mirrors Build 20's own pattern exactly: FORCE ROW LEVEL SECURITY;
SELECT/INSERT/UPDATE policies requiring `organization_id =
tenant_current_organization_id() AND tenant_is_platform_context()`; no
DELETE policy on either table (matched by an explicit `REVOKE DELETE` grant,
defense-in-depth); membership uses `status = INACTIVE`, goals use
`status = ARCHIVED`, in place of deletion.

A new, separate `crm_sales_team_enforce_relationship_integrity()` trigger
function (SECURITY INVOKER, its own migration — Build 19's and Build 20's
own historical trigger functions are untouched) closes the nested
cross-tenant FK gap this table shape introduces: `crm_sales_team_members
.manager_id`, when set, must reference a member row in the **same**
organization (self-referential — a rep's manager must themselves be an
explicit, same-organization participant); `crm_sales_goals
.sales_team_member_id`, when set, must reference a member row in the same
organization. Build 19/20 already found and fixed a real vulnerability
class in exactly this shape (nested cross-tenant FK relationships); this
build does not regress it — proven by 33 restricted-role tests
(`tests/integration/db/sales-team-rls.test.ts`), including a deliberately
constructed cross-tenant fixture (a forged tenant context asserting
`isPlatformStaff: true` while pointed at a different organization — the
exact hypothetical the trigger's own migration comment describes; RLS's own
INSERT policy already makes a *genuinely* customer-scoped context unable to
reach either table at all, so this is the only way to construct the
adversarial premise the trigger defends against).

## Audit and notifications

Reuses the existing `CRM` audit category (no new category): member
added/removed, manager changed, goal created/archived. Aggregated
performance/leaderboard reads are **not** audited — a read of already-
authorized data, not a mutation, the same "audit the outcome, not every
read" discipline every prior CRM extension already establishes.

Reuses the existing `CRM_ACTIVITY` notification category with two new
templates, exact mirrors of `crm.task.assigned`/`crm.deal.assigned`:
`crm.sales_team.member_added` (fires when a user is added to the team) and
`crm.sales_team.goal_assigned` (fires only when a goal has a real
`salesTeamMemberId` — never for an organization-wide goal, which has no
single recipient). Manager changes and goal archival are deliberately not
notified — the same "don't notify on every routine action" discipline
`crm.deal.assigned`'s own comment establishes for stage moves.

## UI

`/admin/crm/sales-team` — the overview: period/metric-selectable
leaderboard, roster, an "Add a sales team member" form (management-gated),
and organization-wide targets/quotas (visible to all readers, manageable by
`crm.sales_team.manage` holders, including their own creation form).
`/admin/crm/sales-team/[id]` — a rep's own detail page: manager control,
removal control (management-gated), period-selectable performance cards,
and that rep's own targets/quotas with real goal-attainment percentages. The
CRM dashboard (`/admin/crm`) gained a "Sales team" stat card, gated on
`crm.sales_team.read`, linking to the overview — the same discoverability
pattern every prior module's own dashboard card already establishes. No new
visual language: every surface reuses the existing design system's
components, spacing, and color tokens; every `Select` is the shared
`components/ui/select.tsx` primitive.

## Security

Adversarially reviewed by Claude directly (Codex's own background
dispatch was attempted three times and interrupted each time by external
infrastructure failures — a usage-limit window, then a second usage-limit
hit immediately on retry, then a model-capacity error mid-review with no
findings ever written; see the completion report for the full account).
The review covered forged/cross-tenant IDs, direct server-action
invocation bypassing the UI, mass assignment, non-platform-staff
assignment, manager self-reference/escalation, goal manipulation
(including the app-layer/DB-CHECK truth-table match and the malformed-
currency class of bug Build 20's own review found once already),
historical-attribution tampering, leaderboard/performance data leakage,
unsafe rendering, and audit/notification spoofing. No CRITICAL or HIGH
findings. Three real LOW-severity findings, all fixed with regression
coverage (`tests/integration/db/sales-team-security-fixes.test.ts`):

1. **LOW — the losing side of a genuine concurrent `createGoal()` race
   got an unhelpful generic `DatabaseError` instead of a clean
   `ConflictError`.** `createGoal()`'s own app-layer pre-check
   (`findOverlapping()`) already gives a clean error for the common,
   non-racing case, and the database's `EXCLUDE USING gist` constraint
   was always the real, unconditional correctness guarantee either way —
   no duplicate/conflicting goal could ever actually persist. The gap
   was purely in error-message quality for the rare genuine-race case,
   and it uncovered something non-obvious in the process: this Prisma 7
   + `@prisma/adapter-pg` combination wraps a raw Postgres error it has
   no specific P2xxx code for behind a generic known-request-error code
   (observed as `P2039`), with the real SQLSTATE nested at
   `error.meta.driverAdapterError.cause.originalCode` — and a genuinely
   concurrent race for the same GIST exclusion constraint surfaces as
   Postgres `deadlock_detected` (40P01), not the simpler ordered
   `exclusion_violation` (23P01) a sequential test would suggest. Fixed
   in `src/lib/db/errors.ts`'s own `translatePrismaError()` — a shared,
   platform-wide function — by extracting the real nested SQLSTATE and
   mapping both codes to `ConflictError`; full regression suite re-run
   after touching it, zero regressions.
2. **LOW — a malformed custom goal period (`periodStart >= periodEnd`)
   via a direct/forged action call threw an unhandled `RangeError`,**
   surfacing as a generic 500 (`InternalServerError`) instead of a clean
   validation error. Not reachable from the real UI, which only ever
   sends a named `period`; the database's own `period_order_check` CHECK
   constraint remained a real second line of defense against actual data
   corruption throughout. Fixed with a `superRefine()` check on
   `createGoalSchema` itself, so it fails at the same clean
   `ValidationError` boundary every other input-shape problem already
   does.
3. **LOW (documented, not fixed) — `listDirectReports(managerId)`
   doesn't independently re-verify `managerId`'s own organization
   ownership before querying**, unlike every other function in
   `crm-sales-team-service.ts` that accepts an entity id. Judged not to
   need a fix: RLS's own SELECT policy already scopes the query, and
   every `crm_sales_team_members` row only ever belongs to the one
   platform organization in real operation — a hypothetical
   different-organization `managerId` simply returns zero rows, never
   another organization's actual data. An explicit app-layer check here
   would be pure redundant boilerplate. Documented directly in that
   function's own comment.

Server inputs are Zod-parsed with unknown fields stripped (no
`.passthrough()` anywhere in this module), preventing mass assignment of
`organizationId`/`status`/`id`/actor fields. Every mutation independently
re-resolves `crm.sales_team.manage`; no downgrade path from `.read`
exists. `assertPlatformStaffMember()` is correctly reused for the one
place a raw `userId` is accepted as a new assignment
(`addSalesTeamMember()`). No `dangerouslySetInnerHTML` or equivalent
exists anywhere in this module's own new files.

## Accessibility

Production Playwright + axe-core coverage
(`tests/e2e/sales-team-accessibility.spec.ts`, 17 tests) scans the overview
and rep-detail pages in light and dark themes; both pages across
desktop/tablet/mobile; the overview's open member-add and rep-detail's open
manager-reassignment selects; a dirty new-goal form; a freshly-added
member's own genuinely-empty "no targets or quotas yet" state; and confirms
ordinary keyboard tab progression reaches multiple real interactive
elements without a focus trap.

The same pre-existing, **platform-wide** Radix `Select`/`aria-hidden` defect
Build 20 first documented (opening any `Select` in this app applies
`aria-hidden` to the whole sidebar/`<main>` app-shell wrapper, because the
shared `Select` wrapper runs in Radix's default `modal` mode) reproduces
again here, on a completely different set of pages — now confirmed across
**two consecutive builds**. Per this build's own explicit instruction to
evaluate whether a narrowly safe shared fix is appropriate: it is not judged
safe to make as a side effect of a Sales Team build — the fix
(`src/components/ui/select.tsx`, likely `modal={false}` on the shared
`Select` root) is a platform-wide, foundational-component change used by
dozens of pages across every historical module, and deserves its own
dedicated task with full cross-module regression testing, not a change
folded into this commit. It remains excluded, with a full inline rationale,
only in the one test that deliberately leaves a Select open; every other
scan in this suite runs with the complete, unmodified axe rule set. Given
it has now recurred in two builds, prioritizing that dedicated fix task is
recommended.

## Performance (system)

Every aggregate (`crm-sales-performance-repository.ts`) runs as real
Postgres `SUM`/`COUNT`/`GROUP BY`, never a full row list pulled into
JavaScript to sum by hand — the same discipline `crmDealRepository`'s own
forecast methods already establish. `getSalesPerformanceSummary()` computes
every active rep's own numbers in one pass of grouped queries (never one
query per rep). Indexes follow the actual filters:
`(organization_id, status)`/`(user_id)`/`(manager_id)` on
`crm_sales_team_members`; `(organization_id, sales_team_member_id,
status)`/`(organization_id, kind, metric, status)` on `crm_sales_goals`.
Every list is bounded (roster and goal lists capped at 200, matching every
other CRM settings-style list's own realistic-size assumption) — confirmed
as a real, enforced Prisma `take`, not just a documented convention.

Codex's Phase 8 (read-only) review found 3 real issues (0 HIGH, 2 MEDIUM,
1 LOW):

1. **MEDIUM — goal attainment was a genuine N+1.** Both the overview page's
   organization-wide goal list and a rep's own detail page called
   single-goal `getGoalAttainment()` once per active goal inside a
   `Promise.all()` — each call independently re-resolved authorization and
   opened its own tenant transaction (~18-19 SQL statements per goal, most
   of it the same fan-out cost every service call already pays). At 20
   active goals that's 360-380 statements just for attainment. Fixed with
   `getGoalAttainments(goalIds)`: one auth resolution, one tenant
   transaction, and at most one aggregate query per distinct
   (metric, period) group among the given goals — goals sharing the same
   named reporting window (the common case) share the underlying aggregate
   entirely. `getGoalAttainment()` is now a thin single-id wrapper over the
   batched function, not a separate implementation.
2. **MEDIUM — the highest-traffic closed-deal aggregate
   (`closedDealsByActor()`, called by every performance summary twice and
   again by every revenue/deals-won goal) had no index matching its own
   query shape.** Build 20's own `crm_deal_history` index
   (`organization_id, deal_id, occurred_at`) can't use its own third key
   for an `organization_id + type + occurred_at` filter, since `deal_id`
   (unconstrained by this query) sits in between. Fixed with a new,
   partial, covering index,
   `crm_deal_history_org_type_occurred_close_idx`
   (`organization_id, type, occurred_at INCLUDE (actor_user_id, deal_id)
   WHERE type IN ('WON','LOST')`) — a purely additive Build 21 migration;
   Build 20's own historical index and migration are untouched and remain
   correct for the deal-timeline queries they were built for.
3. **LOW (documented, not fixed) — both pages fetch the active roster
   twice** (once directly for roster display, once again inside
   `getSalesPerformanceSummary()`/via the manager-candidate picker). The
   underlying table is tiny, so Codex's own review rated the duplicate
   *query* itself LOW impact — the real cost is the duplicate
   authorization/tenant-context fan-out, which is the same accepted,
   documented, platform-wide pattern Build 20's own review already found
   and left as an out-of-scope limitation. A proper fix needs a shared
   page-data/facade service reused across roster display, performance-row
   construction, and manager candidates — judged a large enough
   restructuring, for a small enough real cost, to defer rather than fold
   into this build.

Confirmed non-findings worth stating plainly: `getSalesPerformanceSummary()`
has no per-rep N+1 (one roster load, seven grouped aggregates, mapped in
memory); those seven aggregates share one interactive-transaction
connection so `Promise.all` doesn't provide real DB concurrency — matching
Build 20's own conclusion for its own analogous forecast summary, opening
seven separate tenant transactions to force true concurrency would cost
more than it saves at this scale; the other historical tables' own indexes
(`crm_activities`, `crm_leads`, `crm_deals`) already adequately support this
module's own query shapes at realistic scale, with no further index
additions justified.

## Concurrency

Duplicate active membership is prevented by a database partial unique
index (`crm_sales_team_members_one_active_per_user`), not merely an
application-layer check — a genuine race between two simultaneous "add
member" requests for the same user can only ever produce one winner.
Overlapping goal creation is prevented by the database `EXCLUDE USING gist`
constraint described above, for the same reason. Goals being immutable
(create + archive only, no in-place edit) removes the "concurrent goal
update" race class entirely rather than solving it with locking. Team
membership/manager changes are simple single-row updates with no
multi-step invariant to protect beyond what RLS and the relationship-
integrity trigger already enforce on every write.

## Testing

- **Integration/RLS**
  (`tests/integration/db/sales-team-rls.test.ts`, 33 tests): fail-closed,
  two-tenant isolation, forgotten-WHERE protection, the partial-unique-index
  constraint (plus the rejoin-creates-a-new-row positive control), the full
  `EXCLUDE USING gist` matrix (overlapping/adjacent/different-metric/
  different-kind/archived-frees-the-period), every CHECK constraint
  (value-matches-metric truth table, range checks, period ordering), and
  the relationship-integrity trigger for both `manager_id` and
  `sales_team_member_id`.
- **E2E** (`tests/e2e/sales-team.spec.ts`, 10 tests, real `next build` +
  `next start`): access control across roles, a full rep lifecycle
  (add → view → reassign manager → remove → rejoin), per-rep and
  organization-wide target/quota creation with real attainment display and
  archival, leaderboard period/metric filtering, a rep's own performance
  page, direct access to a nonexistent rep, and mobile/tablet usability.
- **Accessibility**
  (`tests/e2e/sales-team-accessibility.spec.ts`, 17 tests): see
  "Accessibility" above.
- **Security-fix regression**
  (`tests/integration/db/sales-team-security-fixes.test.ts`, 3 tests): the
  concurrent-goal-race `ConflictError` translation (including the real,
  live-verified `deadlock_detected` path — not just the simpler ordered
  `exclusion_violation` a sequential test would produce) and the malformed-
  custom-period `ValidationError` — see "Security" above.
- **Regression**: the full pre-existing Vitest suite (unit + integration,
  947 tests including this build's own 36 new ones: 33 RLS + 3 security-
  fix) was re-verified with zero regressions after every change in this
  build, including after touching the shared `src/lib/db/errors.ts` for
  the concurrency-error fix; the pre-existing Build 19/20 CRM/Sales
  Pipeline E2E/accessibility suites were spot-checked via their own full
  Vitest RLS/security-fix coverage (which exercises `translatePrismaError()`
  extensively) rather than a full E2E re-run, since the `errors.ts` change
  is purely additive (two new SQLSTATE cases; every existing P2002/P2025
  path is untouched). No historical test was weakened.

All of the above pass cleanly. This machine has the same pre-existing,
documented memory-pressure condition Build 19/20 already recorded (as low
as ~60MB free of ~16GB), which can make a long sequential Playwright run
flaky on login timing alone — never on selector or application logic,
confirmed by re-running the identical failing tests immediately after a
fresh server restart and seeing them pass cleanly. Mitigated the same way
those builds established: smaller `--grep`-scoped batches with a fresh
production server between batches.

## Known limitations

- No sales quotas/commissions/leaderboards/rep-performance-analytics beyond
  what's described above — full commission accounting belongs to Roadmap
  Module 43, not this build.
- No proposal generation, contracts, or e-signatures.
- No telephony integration (dialer, recording, transcription) — calls are
  measured via already-logged `CrmActivity` records only.
- No calendar/scheduling integration — appointments are measured via
  already-logged `CrmActivity` records only, with no scheduled/completed
  status distinction (this app has no future/scheduled activity state).
- No appointment → won-deal conversion metric (no structural link exists
  between one activity and one deal's eventual outcome; fabricating one
  was explicitly rejected rather than silently built dishonestly).
- Lead-conversion-rate attribution uses the lead's current assignee (live),
  not an immutable actor, unlike deal/activity attribution — a deliberate,
  documented, lower-stakes simplification (see "Historical attribution").
- The pre-existing, platform-wide Radix `Select`/`aria-hidden` accessibility
  defect (see "Accessibility") is not fixed here — now confirmed across two
  builds, real, and worth a dedicated fix task, but out of this build's own
  scope.
- No `SalesTeam` grouping entity — a genuinely multi-team sales
  organization (multiple regions/pods with their own managers-of-managers
  hierarchy) is not modeled; the flat `managerId` self-reference supports
  one level of "my direct reports" only, sufficient for this platform's
  actual single internal sales function.

## Future compatibility

Roadmap Module 43 (Commissions) can read the immutable close-actor
attribution this module already computes
(`CrmDealHistory.actorUserId` on WON/LOST entries) directly, with no schema
change needed on this module's side, to determine who earns a commission on
a given deal. Roadmap Module 48 (Employee Management), if built, should
treat `CrmSalesTeamMember` as one narrow, sales-specific extension of
platform-staff participation — not something this module's own identity
model needs to anticipate or restructure for. Any future module needing a
genuine multi-team hierarchy should extend `CrmSalesTeamMember`'s existing
`managerId` concept (or introduce a real `SalesTeam` grouping entity at that
point, once a genuine need exists) rather than introduce a parallel
membership system, matching this build's own "extend, don't rebuild"
relationship to Build 19/20.
