# Task Management

Build 28 — Roadmap Module 22. A cross-domain, normalized READ MODEL and
orchestration layer over four existing task sources — never a second
authoritative copy of any of them, and never a "Project Management v2."
Roadmap Module 23 (Service Management) is next and was **not** started
by this build.

## Canonical scope

Task Management owns exactly three things:

1. A normalized, read-only **view contract** (`TaskItem`) over
   `ProjectTask` (Build 27), `CrmTask` (Build 19), and
   `CrmClientOnboardingChecklistItem`/`CrmClientOnboardingRequirement`
   (Build 23).
2. A single genuinely standalone task entity, `InternalTask`, for
   internal admin work that has no home in any of the above.
3. Cross-source **mutation dispatch** — every mutation still executes
   through the owning source's own authoritative service; this module
   adds no shortcut write path for source data.

It explicitly does **not** own: subtasks, dependencies, comments,
attachments, or recurrence for any source (each source's own build
already owns these, or a future module will — see "Explicitly
out of scope" below).

## Existing source-task inventory (why each stays authoritative)

| Source | Owning build | Real table | Why it stays authoritative |
|---|---|---|---|
| `PROJECT_TASK` | 27 | `project_tasks` | Owns subtasks, dependencies, milestones, QA, customer visibility |
| `CRM_TASK` | 19 | `crm_tasks` | Owns lead/company/contact linkage, CRM activity timeline |
| `ONBOARDING_CHECKLIST` | 23 | `crm_client_onboarding_checklist_items` | Owns onboarding-stage sequencing |
| `ONBOARDING_REQUIREMENT` | 23 | `crm_client_onboarding_requirements` | Owns document/requirement collection flow |
| `STANDALONE_TASK` | 28 (this build) | `internal_tasks` | New — see below |

No source's table, service, or UI is modified by this build beyond two
call sites reusing an already-existing shared utility
(`assertPlatformStaffMember`, Build 19).

## The standalone task decision

A narrow `InternalTask` model was added — checked for naming ambiguity
against `Task`/`WorkTask`/`GeneralTask` before naming it (no existing
model uses any of those, but `InternalTask` was chosen deliberately to
read as "belongs to no other domain," not as a generic catch-all).
Fields mirror `CrmTask`'s own shape (id, organizationId, title,
description, status, priority, assignedToUserId, dueAt, lifecycle
timestamps) plus a CHECK-constrained `cancelledReason`, matching Build
27's own idiom exactly. `priority` reuses the existing `ProjectPriority`
enum rather than inventing a duplicate. No DELETE grant — cancellation
is the terminal write, matching every other domain in this build.

## Global task representation

`TaskItem` (`src/lib/tasks/types.ts`) is a **view contract**, not
another persisted task — every field is a hand-picked projection of a
row that still lives, and is still mutated, in its own source:

```ts
interface TaskItem {
  key: string;                 // "SOURCETYPE:sourceId"
  sourceType: TaskSourceType;
  sourceId: string;
  title: string;
  descriptionPreview: string | null;
  status: NormalizedTaskStatus;   // small, lossy, display/filter only
  sourceStatus: string;           // the untranslated original — never discarded
  priority: ProjectPriority | null; // null = NOT_SET, never fabricated LOW
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  isOverdue: boolean;
  createdAt: Date;
  completedAt: Date | null;
  context: TaskItemContext;       // company/project/onboarding names+ids for display/deep-link
  href: string;                   // deep link to the AUTHORITATIVE source detail page
  capabilities: TaskItemCapabilities; // UX-only — see "Quick actions"
}
```

## Global identifiers

`"SOURCETYPE:sourceId"` (e.g. `"PROJECT_TASK:3f2c…"`), built by
`taskItemKeyToString()` and parsed by `parseTaskItemKey()` — which
**returns `null`, never throws**, on any malformed/unknown input (no
colon, unknown source type, empty id). Every mutation dispatcher treats
a `null` parse as `NotFoundError`, not an internal error, since the key
is always client-controlled. A key's `sourceType` is **never** trusted
for authorization on its own — it only selects which real source
service handles the request; that service re-resolves its own
authorization and its own `findById` against its own real table, so a
key claiming the wrong `sourceType` for a real id from a different
table simply 404s (see "Authorization intersection").

## Frozen source types

`PROJECT_TASK | CRM_TASK | ONBOARDING_CHECKLIST | ONBOARDING_REQUIREMENT
| STANDALONE_TASK` — deliberately closed. Notifications, approvals,
audit events, support tickets, and sales deals are NOT normalized into
tasks here, regardless of how "actionable" they feel.

## Status normalization

A small semantic set — `OPEN | IN_PROGRESS | BLOCKED | COMPLETED |
CANCELLED` — computed per-source by `normalizeTaskStatus()`
(`src/lib/tasks/status.ts`) via an explicit `Record<string,
NormalizedTaskStatus>` map per source. **An unmapped raw status throws**
— silent guessing is treated as a bug, not a fallback. `sourceStatus` on
every `TaskItem` always carries the real, untranslated original value.
The reverse map (`status-denormalize.ts`) powers filtering: a normalized
filter (e.g. `CANCELLED`) is expanded back to that source's own real raw
statuses before being pushed into SQL — a source with no matching raw
status (e.g. onboarding items have no `CANCELLED` concept) denormalizes
to an empty list, which correctly excludes every row from that branch
via `status_raw = ANY('{}')` (always false), no special case needed.

Every mutation routes to the source's own authoritative transition
service — this module never flips a raw `status` column itself for any
source but `InternalTask`.

## Priority normalization

`priority: ProjectPriority | null` — `null` means **NOT_SET**, not
"low." `CrmTask` and both onboarding item types have no priority
concept at all and always project a literal SQL `NULL`; a priority
filter against one of those sources evaluates `NULL = ANY(...)` (falsy)
and correctly excludes every row, made explicit via a `hasPriorityColumn`
flag rather than relied on implicitly.

## Assignments

Only existing platform `User` identities — no new worker/employee
identity introduced (Roadmap Module 48, Employee Management, is future
and out of scope). New `InternalTask` assignments are validated through
`assertPlatformStaffMember()` (Build 19), which requires an **ACTIVE**
platform-organization membership; a task assigned to staff who are later
deactivated remains readable (the historical `assignedToUserId` FK is
never cleared by deactivation). Each source's own assignment rules are
otherwise untouched — Task Management never expands who a source will
accept as an assignee.

## Due / overdue semantics

**Deliberate, documented deviation from a literal instant-comparison
formula: UTC calendar-day granularity**, not raw timestamp comparison:

```
isOverdue    = dueAt is set AND dueAt's UTC date < today's UTC date AND status is not terminal
DUE_TODAY    = dueAt's UTC date == today's UTC date (not terminal)
UPCOMING     = dueAt's UTC date > today's UTC date (not terminal)
NO_DUE_DATE  = dueAt is null
```

A completed or cancelled task is **never** overdue, regardless of due
date — a terminal task has no forward-looking status. This is
implemented identically twice, by construction: once as a pure TS
function (`src/lib/tasks/due-window.ts`, used for the mapped `TaskItem`)
and once as raw SQL fragments (`DUE_WINDOW_SQL` in
`global-task-query-repository.ts`, used for filtering at the database
layer) — both use `(col AT TIME ZONE 'UTC')::date` boundary comparison,
so a due-window filter and the displayed `isOverdue` flag can never
silently disagree. Day granularity (not per-user local time) was chosen
specifically so "overdue" and "due today" stay mutually exclusive
buckets — a raw instant comparison would let a task due later *today*
read as already overdue the moment the clock passes midnight UTC, which
contradicts the "Due Today" bucket's own name.

## Global pagination strategy (frozen)

**A single raw SQL `UNION ALL`** across every authorized source table,
with one real `ORDER BY` + `LIMIT`/`OFFSET` applied to the **unioned**
result — not the rejected "fetch top-N per source, merge/truncate in
application code" shape, which silently drops genuinely-earlier rows
once one source's own page fills first.

Each branch (`global-task-query-repository.ts`) is a two-level query:
an inner `SELECT` aliases each source's own differently-named real
columns (`due_date` vs `due_at`, `assigned_to_user_id` vs
`responsible_user_id`) onto one shared column set, scoped only by
`organization_id`; an outer `SELECT ... WHERE` applies every shared
filter (assignee/status/priority/due-window/search) against those
shared alias names uniformly. Shared filters cannot be pushed into the
inner `SELECT`'s own `WHERE` — SQL evaluates a `WHERE` against the
`FROM` table's real columns, before the `SELECT` list's own aliases
exist — so a naive single-level version would silently reference the
wrong (or a nonexistent) real column on at least one source. This was
caught and fixed during construction, before any database testing.

Every SQL literal (`sourceType`, filter arrays, search text) is bound
through `Prisma.sql` tagged templates — zero string concatenation
anywhere, including the source-type literal itself (`Prisma.raw()` was
deliberately removed from an earlier draft for defense-in-depth, even
though the value only ever came from a fixed 5-entry union).

Deterministic ordering, identical in the SQL `ORDER BY` and the pure-TS
`compareTaskItems()` comparator: **`dueAt ASC NULLS LAST, createdAt ASC,
sourceType ASC, sourceId ASC`**.

`countAll()` runs the same unioned query wrapped in `COUNT(*)` — a real
count, not an estimate; see the Codex Performance Engineer findings
below for the scale tradeoff this implies.

## Authorization intersection — the load-bearing security property

```
Task visible in Task Management
  = actor may access Task Management (task_management.read / .team_read)
    AND actor may independently access that source (e.g. delivery_projects.read)
```

`task_management.read`/`.team_read` alone **never** widens visibility
into `ProjectTask`/`CrmTask`/onboarding data. `authorizedSourceTypes()`
(`global-task-service.ts`) checks each source's own real permission
against the caller's already-resolved `AuthorizationContext.permissions`
set exactly **once** per request — no per-row, no per-source DB
round-trip — and only the resulting list is ever passed to
`global-task-query-repository.ts`, which is itself **deliberately
authorization-blind**: it has no permission opinion at all and will
include whatever `sourceTypes` it's handed. This split — permission
resolution entirely outside the query layer, the query layer trusting
its caller completely — is the load-bearing security property of this
whole module; a bug in the query repository can produce wrong rows, but
it cannot produce an authorization bypass, because the query repository
never had the authority to widen access in the first place.

`STANDALONE_TASK` is gated by `task_management.read`/`.manage`
themselves, since it's this module's own native domain.

### Permissions

| Key | Scope | Grants |
|---|---|---|
| `task_management.read` | PLATFORM | Use the aggregation surface; see your own "My Tasks" |
| `task_management.team_read` | PLATFORM | See other staff members' assignments ("Team Tasks") — separate, broader |
| `task_management.manage` | PLATFORM | Create/edit/complete/cancel `InternalTask` only |

`platform_owner`/`platform_admin` hold all three; `support_admin` holds
only `task_management.read` (day-to-day visibility, not team-wide
visibility or standalone-task authoring). `task_management.*` was
checked against existing/reserved/dormant permission keys before
naming — no collision existed, unlike Build 27's own `projects.*`
surprise, but the namespace was still chosen deliberately for the
module's own clarity, not merely because it was unclaimed.

## Mutation delegation

Every dispatcher in `global-task-service.ts`
(`completeGlobalTask`/`reopenGlobalTask`/`cancelGlobalTask`/
`assignGlobalTask`/`changeGlobalTaskDueDate`) is a thin `switch` on the
parsed key's `sourceType`, calling the **real, already-existing**
exported source-domain service function — never a new raw-Prisma write
path. Each dispatcher adds no privilege of its own: the underlying
source service independently re-resolves its own authorization, its own
tenant scope, and its own concurrency (CAS) protection, exactly as it
does when called directly from that source's own admin UI. An operation
a source doesn't support throws an explicit `ValidationError`, never a
silent no-op:

| Operation | PROJECT_TASK | CRM_TASK | ONBOARDING_CHECKLIST | ONBOARDING_REQUIREMENT | STANDALONE_TASK |
|---|---|---|---|---|---|
| Complete | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reopen | ✓ | ✗ | ✓ | ✗ | ✓ |
| Cancel (via Task Mgmt) | ✓ | ✓ | ✗ | ✗ | ✓ |
| Reassign | ✓ | ✓ | ✗ | ✗ | ✓ |
| Change due date | ✓ | ✓ | ✗ | ✗ | ✓ |

The gaps for onboarding items are real, honest limitations — Build 23
never gave `CrmClientOnboardingChecklistItem`/`Requirement` a reopen,
reassign, or due-date-change service function, and this build
deliberately did **not** extend Build 23's own source domain to fill
them (that would violate "source domain owns mutations"). `UI`
capability flags mirror this table exactly (`capabilitiesFor()`), so an
unsupported action is never even offered, not merely rejected server-side.

## Explicitly out of scope

- **Subtasks / dependencies**: `ProjectTask` already owns both; Task
  Management may display context (e.g. "blocked by N tasks") but never
  migrates them or creates cross-domain parent/child relationships. A
  standalone `InternalTask` can never become a `ProjectTask`'s parent.
- **Comments**: no generic comment layer over all tasks — each source's
  comments stay source-owned. `InternalTask` has no comments (not
  required by this build's scope).
- **Attachments**: Roadmap Modules 45/56 own general storage; Build 27
  already established metadata-only project attachments. No `Task
  Attachments` concept was added here.
- **Recurring tasks**: Roadmap Module 38 (Workflow Automation)'s domain.
  No recurrence scheduler or automation engine was built; effectively
  deferred, since no committed roadmap doc requires anything narrower
  right now.
- **Bulk actions**: not built — deferred per the master authorization's
  own explicit instruction not to build them speculatively.

## Customer Portal — My Tasks

`/portal/tasks` (`portal-project-service.ts`'s `listMyTasks()`)
replaces Build 26's honest "not available yet" placeholder with a real,
narrow, customer-safe view — **deliberately not routed through
`global-task-service.ts` at all**, since that surface is platform-staff
-only by construction (`task_management.*` is never granted to a
customer-portal identity) and spans sources that must never reach a
customer (CRM tasks, internal standalone tasks, staff-only onboarding
items).

**Onboarding items are excluded entirely** — confirmed during recon:
neither `CrmClientOnboardingChecklistItem` nor
`CrmClientOnboardingRequirement` has any customer-visibility or
customer-responsibility field, only internal staff
`assignedToUserId`/`responsibleUserId` `User` foreign keys. There is no
safe subset to show.

The view is customer-visible **root** `ProjectTask` rows
(`customerVisible: true AND parentTaskId IS NULL`) across every one of
the customer's own non-`DRAFT` projects, fetched in a single bounded
query (`projectTaskRepository.listCustomerVisibleForOrganization()`,
capped at 200) — never a per-project loop. The returned shape
(`PortalTaskSummary`) reuses the exact customer-safe projection rules
`getMyProjectDetail()` already established for the single-project view:
no assignee identity, no QA, no approvals, no dependency graph.

**Visibility is not assignment.** `ProjectTask.assignedToUserId` is an
internal staff `User`, never a customer-portal identity — a task
appearing on this page means "you can see this," never "this is
assigned to you." The page is never filtered or labeled as the
customer's own assigned work, and no email-based inferred assignment is
performed anywhere in this build.

## Customer 360 / Client Success

No lightweight Task Management summary was added to Customer 360 in
this build — not required by the frozen scope, and would have been the
kind of speculative surface the master authorization explicitly warns
against. The extension point (compose through `global-task-service.ts`,
never a direct query) remains open for a future build if genuinely
useful.

Client Success's Build 25 health formula is **untouched** — task
overdue counts were not folded into it, since no direct roadmap
dependency requires that and the formula is explicitly frozen. A future
integration seam is left open but nothing was wired.

## RLS

`internal_tasks` follows the exact `crm_tasks` shape: `ENABLE` +
`FORCE ROW LEVEL SECURITY`, three policies (SELECT/INSERT/UPDATE) all
requiring `organization_id = tenant_current_organization_id() AND
tenant_is_platform_context()`, no DELETE policy, and an explicit
`REVOKE DELETE ON internal_tasks FROM alpha_os_app`. Every other source
table keeps its own existing, already-audited RLS — this build changes
none of it.

The cross-domain aggregator (`global-task-query-repository.ts`) runs
inside the same platform-scoped `withTenantContext()` transaction every
other platform-owned read in this codebase uses — RLS applies per
underlying table normally, raw SQL or not, for every branch of the
union.

## IDOR / cross-domain threat model

A global aggregator is a plausible cross-domain IDOR surface by
construction (many source tables, one entry point) and was treated
accordingly. Verified directly (both by a live database integration
suite — `tests/integration/db/task-management-security.test.ts` — and
by manual code-path review of the full attack list below, since the
Codex Security Engineer dispatch for this build was blocked by the
provider's own content-safety filter mid-task and produced no report;
continuing with manual review rather than re-attempting a differently
-worded prompt, per this build's own "if Codex repeatedly fails,
continue with Claude" guidance):

- **Forged/malformed global key** — `parseTaskItemKey()` returns `null`
  for any unknown source type, missing separator, or empty id; every
  dispatcher treats that as `NotFoundError`.
- **`sourceType`/`sourceId` mismatch** — a key claiming the wrong source
  for a real id from a different table simply fails that source's own
  `findById` (independent, randomly-generated UUID primary keys per
  table); no cross-table collision path exists.
- **Cross-tenant lookup / permission widening** — every mutation
  dispatcher calls the source's own real, already-audited service
  function, which independently re-resolves tenant scope and
  authorization; `SOURCE_PERMISSION`/`MANAGE_PERMISSION` were checked
  against the real permission catalog (no typos, no stale keys).
  `task_management.*` never appears as a check inside any per-source
  read filter — verified by direct inspection of `roles.ts`'s new
  entries (`PLATFORM_FULL` plus two explicit platform-role additions
  and one narrower `support_admin` addition; no customer/portal role
  touched).
- **Wrong-adapter mutation** — not reachable; see the point above.
- **Forged assignee** — `assertPlatformStaffMember()` requires an
  ACTIVE platform membership; reused unchanged from Build 19, exercised
  identically through the aggregator's `assignGlobalTask` path.
- **Status replay / mass assignment** — `InternalTask`'s CAS-guarded
  repository methods reject a second completion/cancellation
  (`ConflictError`, proven live in the integration suite); Zod input
  schemas for every `InternalTask` mutation accept only
  title/description/priority/assignedToUserId/dueAt — never
  organizationId/createdByUserId/id/completedByUserId from client input.
- **Hidden internal task exposure to Portal** — confirmed by direct
  grep: zero references to `global-task-service`/`internal-task-service`
  anywhere under the Portal route tree.
- **Pagination/filter injection** — every SQL value in
  `global-task-query-repository.ts` is bound through `Prisma.sql`
  tagged templates; zero string concatenation, including the
  `sourceType` literal.
- **Cross-user notification side effects** — the `InternalTask`
  assignment notification's `assignedToUserId` is read from the
  already-persisted row returned by the repository after a successful
  write, never from raw client input; the subscriber sends to exactly
  that one `recipientUserId`.

See `tests/integration/db/task-management-security.test.ts` for the
empirical RLS/tenant-isolation proof (fail-closed with no context,
fail-closed for a bare customer context regardless of which customer
org, `DELETE` denial, cross-source union correctness, real global
pagination across sources, and the empty-`sourceTypes`-array
fail-closed case).

## Performance

`resolveDisplayContext()` batches assignee/project/onboarding/company
name resolution into four `findMany({ id: { in: [...] } })` calls keyed
off only the distinct ids on the **current page** — never the full
result set, never per-row. `authorizedSourceTypes()` resolves once per
request against an already-loaded permission set, never per-row.

See the Codex Performance Engineer findings
(`.codex-tasks/task-management-performance-report.md`, generated
against the live dev database) for the explicit 100k-row correctness/
scale assessment and any indexing follow-ups applied as a result of
that review.

## Concurrency

`InternalTask` completion/reopen/cancellation use the same CAS
(`updateMany` with a status-guard `WHERE`, `ConflictError` on zero rows
affected) idiom as `CrmTask`/`ProjectTask`. `ProjectTask`/`CrmTask`/
onboarding items reuse their own existing protections unchanged — no
second lock layer was added around any source service.

## Audit & notifications

`InternalTask` mutations audit under new `tasks.*` action keys (create,
assignment, status transition, due-date change), reusing the
`ADMINISTRATION` category rather than adding a new enum value for one
module's small handful of actions — the same precedent Build 27
established for `projects.*` (reusing `CRM`). The action-key namespace
is `tasks.*`, deliberately distinct from the `task_management.*`
**permission** namespace, since the audit catalog's own dot-notation
convention requires a single lowercase word before the first dot.
Reading/aggregating existing source tasks is never separately audited
here — those mutations already audit (or deliberately don't) under
their own action keys.

A single new notification category, `TASK_MANAGEMENT_ACTIVITY` (mirrors
`PROJECT_ACTIVITY` exactly), covers `InternalTask` assignment only — no
reminder scheduler, no due-date-approaching notifications, kept
deliberately high-signal.

## Testing

- **Unit** (`tests/unit/lib/tasks/`): status normalization (including
  the "unmapped raw status throws" guarantee), due-window/overdue
  classification (including terminal-status exclusion), the pure
  ordering comparator (deterministic total order across ties), key
  parse/serialize round-tripping.
- **Integration**
  (`tests/integration/db/task-management-security.test.ts`): live-
  database cross-source union correctness (all 5 branches, one shared
  assignee), assignee/status/priority/due-window/search filtering, real
  global pagination proof across two interleaved sources, RLS
  fail-closed baselines, `DELETE` denial, the `cancelledReason` CHECK
  constraint, and a CAS concurrency race.
- **Data honesty**, verified directly in the above: a source with no
  priority column never reads as `LOW`; a task with no due date is
  never overdue; a completed/cancelled task with a past due date is
  never overdue; an empty `sourceTypes` list returns zero rows rather
  than silently defaulting to "everything."

## Codex Performance Engineer follow-up (applied)

The Codex Performance Engineer review (`.codex-tasks/task-management-performance-report.md`,
run against the live dev database with real `EXPLAIN (ANALYZE, BUFFERS)`
plans) found the global pagination/ordering placement itself correct,
but flagged three P1 issues that would have hurt at real scale, all
fixed in this build:

1. **Status predicates cast to text** (`status::text = ANY(text[])`)
   prevented native-enum index use, and were emitted unconditionally
   even with no status filter requested. Fixed: each branch now applies
   its own natively-typed `status = ANY($1::<that source's real enum
   type>[])` predicate INSIDE its own inner `SELECT`, omitted entirely
   when no status filter is requested.
2. **Due-window predicates wrapped the indexed column** in
   `(due_at AT TIME ZONE 'UTC')::date`, which is not sargable. Fixed:
   boundaries are now computed once as a `timestamptz` constant and
   compared directly against each branch's own bare real due column
   (`due_date`/`due_at`), also pushed into the branch's own inner
   `SELECT`.
3. **Missing composite indexes** on `project_tasks`,
   `crm_client_onboarding_checklist_items`,
   `crm_client_onboarding_requirements`, and a redundant
   organization-less index on `internal_tasks` — fixed by
   `prisma/migrations/20260910171500_task_management_index_tuning/`
   (hand-written, not `prisma migrate dev`'s auto-diff — that diff
   engine flags unrelated pre-existing drift, the `crm_companies`
   unique constraint and the `knowledge_embeddings` pgvector HNSW
   index, that must never be touched by this build).
4. **`InternalTask.listForOrganization()`'s own default ordering** was
   `dueAt` only — not deterministic for ties/nulls. Fixed to
   `dueAt, createdAt, id`, matching the global query's own tie-break and
   a matching new composite index.

Re-verified empirically after the fix (`enable_seqscan = off`
diagnostic, matching the report's own method): the CRM branch's
assignee + status + due-window predicate now collapses into ONE
`Index Cond` with no separate sort step — the same "SARGABLE_TYPED_PREDICATES"
shape the report itself demonstrated as the target state. The full
live-database security/correctness suite
(`tests/integration/db/task-management-security.test.ts`) was re-run
after these changes and still passes unchanged (15/15) — the rewrite
preserved behavior exactly, it only changed how the database reaches
that behavior.

## Known limitations

- No E2E coverage was added in this build for `/admin/tasks` or
  `/portal/tasks` — see the Build 28 completion report for the full gap
  list and rationale.
- `countAll()` is a real `COUNT(*)` over the same unioned query as
  `listPage()` — acceptable at the row counts assessed, but the Codex
  Performance Engineer report flags `getMyTaskCounts()` specifically:
  it issues FIVE separate `countAll()` calls (overdue/due-today/
  upcoming/no-due-date/completed), each independently re-scanning every
  authorized branch — up to 25 branch scans for one "My Tasks" page
  load. Not fixed in this build (the report's own suggested fix — one
  unioned scan with `COUNT(*) FILTER (WHERE ...)` conditional
  aggregates — is a real, contained follow-up, deferred rather than
  risked without a production-shaped load test to confirm the rewrite's
  own correctness first).
- Deep `OFFSET` pages (verified correct, not free — Postgres must
  produce and discard every preceding row) are not capped in the UI. A
  keyset cursor over the existing deterministic ordering tuple would
  remove this cost if deep traversal proves common; not built
  speculatively.
- No `pg_trgm`/GIN index backs the `title ILIKE '%term%'` search — fine
  at the row counts assessed; add one only if a production-shaped
  search workload actually needs it (per the report's own explicit
  recommendation against pre-emptive search infrastructure).
- Onboarding checklist/requirement items have no reopen/reassign/
  due-date-change capability through Task Management, because Build 23
  never gave them that capability natively — see "Mutation delegation."

## Future compatibility

- **Service Management (Roadmap 23)**: not integrated. If it introduces
  its own task-like work items, they should be evaluated against this
  same frozen `TaskSourceType` list rather than assumed to fit
  automatically.
- **Workflow Automation (Roadmap 38)**: the natural home for any future
  recurrence/automation engine touching tasks from any source — this
  build intentionally left that ground untouched.
- **Employee Management (Roadmap 48)**: will introduce a real
  employee/worker identity distinct from platform `User` accounts;
  `InternalTask.assignedToUserId` and `assertPlatformStaffMember()`'s
  own ACTIVE-membership check will need re-evaluation once that model
  exists, since "platform staff" today means "active platform
  organization member," not a dedicated employee record.
