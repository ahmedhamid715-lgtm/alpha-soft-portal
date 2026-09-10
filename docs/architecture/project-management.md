# Project Management

Build 27 — Roadmap Module 21. The operational delivery foundation for
Alpha Page Rankers: Projects, Milestones, project-scoped Tasks/Subtasks,
Dependencies, Assignees, Comments, Attachments, project-specific
Approvals, and QA. Roadmap Module 22 (Task Management) is next and was
**not** started by this build.

## Core thesis: delivery work is platform-owned, composed onto a real customer

Projects are Alpha Page Rankers' own internal operational records ABOUT
a customer — the same ownership shape `CrmClientOnboarding`/
`CrmContract`/`CrmProposal` already established, not a second
customer/tenant root. Every Project belongs to an existing, real
customer `Organization` (via `customerOrganizationId`, mirroring
`CrmClientOnboarding.linkedOrganizationId` exactly) and an existing
`CrmCompany` (via `companyId`) — never inferred by name/domain, always
an authoritative existing link.

```
CrmClientOnboarding (Build 23)
      │  (COMPLETED, delivery handoff)
      ▼
createProjectFromOnboarding()
      │
      ▼
Project ──→ Organization (customerOrganizationId — the real customer)
      │ └─→ CrmCompany (companyId)
      │ └─→ CrmClientOnboarding (originatingOnboardingId, provenance)
      │ └─→ CrmClientOnboardingServiceItem (sourceServiceItemId, provenance — optional)
      │ └─→ ProjectTemplate (sourceTemplateId, provenance — optional)
      │
      ├── Milestone[]
      ├── ProjectTask[] (optionally under a Milestone, optionally a subtask of another ProjectTask)
      │     └── ProjectTaskDependency (same-project only)
      ├── ProjectComment[] (project- or task-scoped, INTERNAL or CUSTOMER_VISIBLE)
      ├── ProjectAttachment[] (metadata/external-link only — no real file storage yet)
      ├── ProjectApproval[] (PROJECT or MILESTONE scope)
      └── ProjectQaCheck[] (PROJECT, MILESTONE, or TASK scope)
```

## Build 23–26 reuse

- **Build 23 (Client Onboarding)**: `CrmClientOnboarding` is the
  handoff source; `originatingOnboardingId`/`sourceServiceItemId` are
  real, validated references, never copied/duplicated data.
  `linkedOrganizationId` is the exact field Project's own
  `customerOrganizationId` is verified against (a relationship-
  integrity trigger rejects a project claiming an onboarding that
  belongs to a DIFFERENT customer).
- **Build 24 (Customer 360)**: Customer 360's own "Projects" section
  (previously the honest `FutureDomainsTab` placeholder) now composes
  real data through Project Management's own safe internal service
  (`listProjectsForCustomer360()`) — Customer 360 never queries
  `Project`/`Milestone`/`ProjectTask` tables directly; the source
  domain (this build) owns that read, matching the same discipline
  every other Customer 360 section already follows.
- **Build 25 (Client Success)**: `evaluateProjectHealth()` — always
  `NOT_MEASURABLE` before this build — now has a real, deterministic
  provider backed by actual Project data (see "Client Success Project
  Health integration" below). Client Success itself was not rebuilt;
  only its own already-existing extension seam was wired to a real
  input.
- **Build 26 (Customer Portal)**: reuses the EXACT same
  `portal-crm-bridge.ts` elevated-read pattern (Project tables are
  platform-owned, same RLS shape as `crm_*` tables — a customer's own
  tenant context cannot read them directly) and the EXACT same
  "customer-safe projection, never an internal DTO with fields hidden"
  principle. `/portal/projects` (previously `PortalUnavailable`) now
  renders a real, narrow `PortalProjectService` projection.

## Project model

`Project` — `organizationId` is always the PLATFORM organization (the
same ownership convention every `crm_*` table already uses — Projects
are Alpha Page Rankers' own operational records, not customer-owned
tenant data). `customerOrganizationId` is the real customer
`Organization`; `companyId` is the `CrmCompany`. Both are required —
there is no "project with no customer" state, matching the master
authorization's own explicit "must belong to an existing customer
Organization... do not create a second customer/account record."

## Onboarding → Project handoff

`createProjectFromOnboarding()` — the ONE controlled operation Build 27
introduces for this handoff (never automatic on onboarding reaching
COMPLETED). Eligibility:

- The onboarding's own `status` must be `COMPLETED` — the only
  unambiguous "ready for delivery" signal Build 23's own lifecycle
  provides. `IN_PROGRESS`/`BLOCKED`/`NOT_STARTED` are not yet ready;
  `CANCELLED` never hands off.
- An optional `sourceServiceItemId` (a specific
  `CrmClientOnboardingServiceItem` belonging to that same onboarding)
  may be supplied — see "Idempotency" for why this matters.
- The caller must hold `projects.manage`.

## Idempotency (one onboarding → one or many projects)

**One onboarding may create MULTIPLE projects — one per sold service
item that genuinely needs its own delivery track** (e.g. an "SEO
retainer" and a "Website Redesign" sold together are realistically two
different delivery teams/timelines, not one project). The uniqueness
key is explicit: `(originatingOnboardingId, sourceServiceItemId)`.

- When `sourceServiceItemId` is supplied: at most one NON-CANCELLED
  project may exist for that exact `(onboarding, service item)` pair —
  enforced by a partial unique index, not just application logic.
  Calling `createProjectFromOnboarding()` twice for the same service
  item returns/rejects with a clear "already handed off" error, never
  a silent duplicate. A project that was later CANCELLED does not
  permanently block a fresh attempt (a cancelled delivery might
  legitimately be restarted).
- When `sourceServiceItemId` is omitted (a "whole onboarding" project,
  for onboardings that don't need a per-service breakdown): at most one
  non-cancelled such project may exist per onboarding — a SEPARATE
  partial unique index (Postgres does not treat two NULLs as equal in
  an ordinary unique index, so this genuinely needs its own index, not
  a shared one).

## Project lifecycle

```
DRAFT ──→ PLANNED ──→ ACTIVE ──┬──→ ON_HOLD ──→ ACTIVE
                                ├──→ COMPLETED ──→ ACTIVE (reopen, privileged)
                                └──→ CANCELLED
DRAFT/PLANNED/ON_HOLD ──→ CANCELLED
COMPLETED/CANCELLED ──→ ARCHIVED (final — no transitions out of ARCHIVED)
```

Every transition is validated against `src/lib/projects/lifecycle.ts`'s
own `canTransitionProject()` table before any write, and every
transition to a terminal-ish status is CAS-guarded
(`updateMany()`-based, matching the established pattern) at the
repository layer — the UI is never lifecycle authority.

- **Terminal-ish statuses**: `COMPLETED`, `CANCELLED`, `ARCHIVED`.
  `ARCHIVED` is the only FULLY terminal one (no outgoing transitions at
  all) — a soft-hide, never a delete.
- **Reopening**: `COMPLETED → ACTIVE` is allowed (a real, common
  "client wants late changes" scenario) but is a PRIVILEGED, AUDITED
  action, not a bare status PATCH — see "Audit."
- **Cancellation** requires a non-blank reason (a CHECK constraint
  using `NULLIF(BTRIM(...), '') IS NOT NULL`, the same Build 25
  Security-Engineer-taught discipline, not a bare `IS NOT NULL`).
- **Completion criteria**: see "Project completion" below.

## Templates

`ProjectTemplate` + `ProjectTemplateMilestone` + `ProjectTemplateTask` +
`ProjectTemplateQaCheck` — project-specific templates only, never a
generic workflow/template engine. Instantiating a project from a
template (`createProjectFromTemplate()`) **snapshots** every template
row into real `Milestone`/`ProjectTask`/`ProjectQaCheck` rows at
creation time — the created rows carry NO live FK back to the template
row that produced them (only `Project.sourceTemplateId` records
provenance, for "this project came from template X" display/audit
purposes). Editing a template afterward never rewrites any
already-created project. **No template versioning** — genuinely not
needed for this build's own scope; editing a template in place is
safe precisely because nothing live depends on it after instantiation.

`relativeDueDays` on template milestones/tasks is the ONLY schedule
mechanism templates carry — an integer offset from the INSTANTIATING
project's own `startDate`, applied at instantiation time. A template
with no `relativeDueDays` set produces a milestone/task with no
`targetDate`/`dueDate` at all — never a fabricated date.

## Milestones

`Milestone` deliberately stores **no mutable status or progress
column** — both are always derived server-side from its own child
`ProjectTask` rows (`calculateMilestoneProgress()`), avoiding the
"redundant mutable progress value that can drift from reality" trap.
The one real mutable fact a milestone stores is its own
`cancelledAt`/`cancelledReason` — a milestone can be dropped from scope
independently of its tasks' own individual states. Ordering is
gap-based (`sortOrder`, starting at 1000-increments), the exact
`moveStage()` algorithm Build 20's own Sales Pipeline stage reordering
already established: a single move computes the midpoint `sortOrder`
between two real neighbors, falling back to a full (but small, single-
project-scoped) renumber only when neighbors have no integer gap left.

## Project tasks — the Roadmap Module 22 boundary

**Build 27 owns PROJECT-SCOPED tasks only.** `ProjectTask` belongs to
exactly one `Project`; it is never a platform-wide personal/team task
engine, and Build 19's own separate `CrmTask` (lead/company-scoped
follow-ups) is a genuinely different concept this build does not touch
or merge with. Roadmap Module 22 (Task Management), when it exists, is
expected to READ/AGGREGATE `ProjectTask` (e.g. a cross-project "my
tasks today" personal view spanning every project a staff member is
assigned to) rather than replace it — `ProjectTask` stays the
authoritative source of PROJECT delivery work; Module 22 owns the
personal/team aggregation VIEW layer on top of it, a seam this build
deliberately leaves open (no schema change needed later — Module 22
can simply query `ProjectTask` filtered by `assignedToUserId` across
projects).

## Subtasks

Self-referencing `ProjectTask.parentTaskId` — **exactly one level of
nesting**, frozen explicitly. A subtask's own `parentTaskId` must
itself be `NULL` (a subtask cannot have subtasks) — enforced by a
relationship-integrity trigger, not just service-layer discipline. A
task can never parent itself (a CHECK constraint). A subtask's
`projectId` must equal its parent's own `projectId` — cross-project
parenting is structurally rejected by the same trigger. Subtasks are
excluded from milestone/project progress denominators directly (see
"Progress") — a subtask's own completion is reflected through its
PARENT task's completion, never counted a second time.

## Dependencies

`ProjectTaskDependency` — a directed edge, `taskId` (the dependent, "B")
→ `dependsOnTaskId` (the prerequisite, "A"): A must complete before B.
Same-project only (a relationship-integrity trigger checks BOTH tasks
resolve to the dependency row's own `projectId`). No self-dependency
(CHECK: `taskId != dependsOnTaskId`). No duplicate edge (a real unique
index on `(taskId, dependsOnTaskId)`).

## Dependency cycle prevention

Full DB-level DAG cycle prevention (a recursive-CTE trigger firing on
every insert) is disproportionate for this build's own scope — an
honest, explicit boundary, not a gap papered over. Cycle prevention is
**service-layer**: `createDependency()` locks the owning `Project` row
(`SELECT ... FOR UPDATE`) to serialize concurrent dependency mutations
for the same project, loads every existing edge for that project
inside the SAME transaction, and calls
`src/lib/projects/dependency-graph.ts`'s own `wouldCreateCycle()` (a
pure BFS reachability check) before the INSERT. The unique index and
self-dependency CHECK are real, additional DB-level guards for the two
narrower cases they can cheaply express; the general cycle case is
closed by this locked, transaction-scoped service check. Proven
directly with the exact scenario the master authorization requires:
A → B → C, then C → A is rejected
(`tests/unit/lib/projects/dependency-graph.test.ts`).

## Assignees

**One assignee per `ProjectTask`** (`assignedToUserId`, nullable,
direct field) — the same single-assignee shape Build 19's own `CrmTask`
already established, deliberately not a many-to-many join table (real
"don't overengineer" call: this build's own delivery work doesn't need
multi-assignee tasks, and adding that complexity now would be
speculative). `Project.ownerUserId` is a separate, single "project
lead" field.

**Customer assignee boundary**: `assignedToUserId` MUST resolve to an
ACTIVE platform-organization member — reuses `assertPlatformStaffMember()`
(`crm-shared.ts`, the same helper Build 19/22/23/25 already use for
this exact validation) unchanged. A customer-organization user can
never become a task assignee; there is no code path that even accepts
a non-platform user id here. **Inactive/suspended staff** cannot
receive NEW assignments (the same `assertPlatformStaffMember()` check
rejects it) but a historical assignment on an already-assigned task
remains fully visible — reassignment is never forced merely because
staff status changed later.

## Deadlines

`Project.startDate`/`targetEndDate`, `Milestone.targetDate`,
`ProjectTask.dueDate` — all real, explicit nullable timestamps, never
fabricated from a template without that template's own explicit
`relativeDueDays` offset. `targetEndDate >= startDate` is validated
(a CHECK constraint, satisfied trivially whenever either is null).
Timezone handling reuses the platform's own existing
`formatInTimeZone`/organization-timezone conventions — no new date
logic invented.

## Priorities

**One shared `ProjectPriority` enum** (`LOW`, `MEDIUM`, `HIGH`,
`URGENT`), used identically by `Project` and `ProjectTask` (and
`ProjectTemplateTask`, snapshotted forward). Milestones have no
priority of their own — they're delivery phases/dates, not
independently prioritized work items; no business need justified a
second or third priority vocabulary.

## Progress

Frozen, deterministic, provenance-exposing — see
`src/lib/projects/progress.ts` for the actual implementation (unit-
tested exhaustively, `tests/unit/lib/projects/progress.test.ts`).

- **Task**: binary. `DONE` = complete; `TODO`/`IN_PROGRESS`/`BLOCKED` =
  incomplete; `CANCELLED` = EXCLUDED from every denominator entirely
  (never counted as either complete or incomplete).
- **Milestone**: `completed root tasks in this milestone / eligible
  (non-cancelled) root tasks in this milestone`. Subtasks are excluded
  (see "Subtasks"). Zero eligible tasks → `NOT_MEASURABLE`, never a
  fabricated 0%.
- **Project**: `completed eligible root tasks / eligible root tasks`,
  across the WHOLE project regardless of milestone (milestone-less
  tasks count too). Zero eligible tasks → `NOT_MEASURABLE`.
- Every result carries `{ percent, completed, eligible }` when
  measured — the UI never shows a bare percentage with no denominator
  context.

## Comments

`ProjectComment` — plain text only (never HTML), rendered as a React
text node client-side (never `dangerouslySetInnerHTML`) — this is what
makes a dedicated HTML sanitizer unnecessary here, unlike
`CrmProposalVersion.bodyHtml`. A comment may be on the project itself
or on a specific task (`taskId` nullable). The author may edit their
own comment at any time (`editedAt` tracked); no delete (matches the
established "never physically delete collaboration history"
discipline). A stored-XSS attempt (`<script>...</script>` as a comment
body) is proven to render as inert text, never executed
(`tests/e2e/project-management.spec.ts`).

## Customer visibility

Structural, explicit, defaults SAFE (internal-only) everywhere — never
inferred from author role, matching the master authorization's own
explicit warning. One shared `ProjectVisibility` enum (`INTERNAL`,
`CUSTOMER_VISIBLE`) reused by `ProjectComment`, `ProjectAttachment`,
and `ProjectApproval`; a plain `customerVisible` boolean (default
`false`) on `Milestone`/`ProjectTask`/the two template child tables
(snapshotted forward). Staff must EXPLICITLY opt a thing into customer
visibility — nothing is customer-visible by default. `Project` itself
has no separate visibility flag: a project's own basic identity/
status/progress/dates are inherently customer-appropriate once the
project is no longer `DRAFT` (pure internal planning) — `DRAFT`
projects are simply never shown in Portal or Customer 360 at all,
regardless of any other flag, which is sufficient and avoids a
redundant field.

Customers never get a comment-authoring UI in this build — Portal
shows `CUSTOMER_VISIBLE` comments read-only. A customer replying is
closer to messaging (Roadmap Module 46) than delivery collaboration,
and is explicitly out of this build's own scope.

## Attachments

Roadmap Modules 45/56 still own generic document/storage
infrastructure — confirmed, again, still not real (Build 26's own
finding: `StorageProvider` throws `StorageNotConfiguredError`,
`CrmClientOnboardingDocument.fileKey` is always `null`). `ProjectAttachment`
is therefore **metadata/reference-ready architecture**: `fileKey`
stays `null` throughout this build (the real seam Module 56 will
populate later), and `externalUrl` is the one HONEST attachment
mechanism this build actually delivers — a staff-entered link to an
externally-hosted file (e.g. Google Drive), validated as a well-formed
URL at the service layer, never a raw filesystem path from a client.
No fake upload UI, no fake "Download" button with nothing behind it.

## Project approvals vs. Roadmap Module 67

Roadmap Module 67 owns a future generic, reusable Approval Engine —
this build does not build one. `ProjectApproval` is narrow and
PROJECT-SPECIFIC: `resourceType` is `PROJECT` or `MILESTONE` only
(never per-task — kept deliberately narrow), `resourceId` is validated
by a relationship-integrity trigger to actually belong to the
approval's own `projectId`. **Self-approval is explicitly forbidden**
at BOTH the database layer (a CHECK: `requestedByUserId !=
approverUserId` whenever both are set) and the service layer (the
same rule re-verified before recording a decision) — belt and
suspenders on the master authorization's own explicitly-named attack
category. No customer-initiated approval action exists in this build
— Portal shows approval status read-only when `visibility =
CUSTOMER_VISIBLE`; there is no "customer approves" button because no
safe, authorized customer action backs one yet.

## QA

`ProjectQaCheck` — `PROJECT`-level (no task/milestone set),
`TASK`-scoped, or `MILESTONE`-scoped (a CHECK ensures at most one of
the two is set, never both). `required` (default true) checks that are
not `PASSED`/`WAIVED` block project completion (see "Project
completion"). A task being `DONE` never implies QA-approved on its own
— completion and QA sign-off are tracked independently, exactly as the
master authorization requires.

## Project completion

`evaluateProjectCompletionCriteria()` (frozen, pure, unit-tested) —
project `COMPLETED` requires ALL of:

- every non-cancelled root `ProjectTask` is `DONE`,
- every non-cancelled `Milestone` is either fully measured-complete
  (100%) or genuinely `NOT_MEASURABLE` (an empty milestone has nothing
  outstanding to block on),
- every REQUIRED `ProjectQaCheck` is `PASSED` or `WAIVED`,
- every `ProjectApproval` is `APPROVED` (none `PENDING`/`REJECTED`).

The only bypass is `completionOverride` — a privileged, separately
audited action (`projects.completed_override`) requiring a non-blank
reason (CHECK constraint, same `NULLIF(BTRIM(...), '')` discipline).
The pure criteria function NEVER reports the override state itself —
only the service layer decides whether to honor it, matching Build
23's own identical `evaluateCompletionCriteria()`/override split.

## Customer Portal integration

`/portal/projects` (list) and `/portal/projects/[id]` (detail) replace
the previous `PortalUnavailable` state with a real, narrow
`portal-project-service.ts` — never the internal `Project`/`Milestone`/
`ProjectTask` objects with fields merely hidden by the frontend. Every
DTO is a hand-picked subset (`PortalProjectSummary`/
`PortalProjectMilestone`/`PortalProjectTask`/`PortalProjectComment`/
`PortalProjectAttachment`), never the Prisma model type. Customer-
visible: project title/description/status/priority/progress/dates;
customer-visible ROOT milestones (title/target date/progress derived
from ALL of that milestone's own child tasks, not just customer-visible
ones); customer-visible ROOT tasks only (title/description/status/
priority/due date — never subtasks standalone, never assignee
identity); comments/attachments with `visibility: CUSTOMER_VISIBLE`
AND (project-level OR attached to a customer-visible root task — a
customer-visible comment on an otherwise-hidden task is NOT shown,
since surfacing it would leak that hidden task's existence by
implication). Project/milestone progress percentages are computed from
the FULL real task set (including internal-only tasks) — a number
alone reveals nothing about hidden task titles/content, so this is
honest without being a structural leak. `DRAFT` projects are excluded
entirely (internal staging, not yet customer-ready) — a DRAFT project's
own id resolves to the same `NotFoundError` a nonexistent or
another-customer's id would (IDOR-safe: never distinguishes "not yours"
from "doesn't exist"). NEVER exposed, at all, in this build: QA checks,
approvals, the dependency graph, internal comments/attachments,
internal (non-customer-visible) milestones/tasks/subtasks, assignee/
owner identity, cost/profitability (this build tracks none), internal
audit, staff performance. Reuses the exact same elevated
`portal-crm-bridge.ts` pattern Build 26 established (`withPortalCrmReadContext()`
directly) — a verified customer's own request
(`requirePermission("portal.access", organizationId)`) opens a narrow,
server-controlled elevated read, filtered strictly by the
already-verified `organizationId`, never a client-supplied one.

## Customer 360 integration

Customer 360's own `FutureDomainsTab` no longer shows "Projects" as
unavailable (Support/Conversations remain honestly unavailable —
Roadmap 30/46 still don't exist). A new "Projects" section composes
real project summaries (status, progress, dates) through Project
Management's own safe internal service
(`listProjectsForCustomer360()`), never a direct query inside
`customer-360-service.ts` itself — the source domain (this build) owns
the read, matching the "compose, don't duplicate" discipline every
prior Customer 360 integration already established.

## Client Success Project Health integration

`evaluateProjectHealth()` (Build 25, previously always
`NOT_MEASURABLE` via the shared `notYetAvailable()` helper) now takes a
real `ProjectHealthInput | null` and has a REAL, deterministic
formula — implemented in `src/lib/crm/client-success.ts`, sourced by
`project-customer-360-service.ts`'s own
`getProjectHealthInputForCustomer360()`. Frozen formula, checked
highest-severity-first (mirrors every other component's own
if/else-chain discipline in that file):

- `NOT_MEASURABLE` when `input` is `null` (no linked organization, or
  the caller lacks `delivery_projects.read` — the exact same
  existence/authorization gate `resolvePaymentHealth()` already
  establishes for Payment Health) OR the customer has zero `ACTIVE`/
  `ON_HOLD` projects. A `DRAFT`/`PLANNED`/`COMPLETED`/`CANCELLED`/
  `ARCHIVED`-only project set is honestly unmeasurable — there is no
  "current delivery work" to judge.
- Inputs are AGGREGATED across every `ACTIVE`/`ON_HOLD` project for the
  customer (never just one "most relevant" project): `onHoldProjectCount`,
  `overdueRequiredTaskCount` (root, non-cancelled tasks with a past
  `dueDate` not yet `DONE`), `blockedRequiredTaskCount` (root tasks
  `BLOCKED`), `pastTargetDateProjectCount` (a project's own
  `targetEndDate` has passed), `approachingTargetDateProjectCount`
  (`targetEndDate` within the next 14 days), `failedRequiredQaCount`
  (required QA checks `FAILED`).
- `CRITICAL` if any required QA check has `FAILED`, OR any project is
  past its target end date and not yet complete, OR 3+ required tasks
  are overdue.
- `AT_RISK` if any project is `ON_HOLD`, OR any required task is
  overdue (1-2), OR any required task is `BLOCKED`.
- `WATCH` if a project's target end date is within the next 14 days
  with none of the above signals present.
- `HEALTHY` otherwise — every active project on track, no overdue/
  blocked/failed signals.
- This is a NARROW, factual, deterministic classification — never a
  second copy of Client Success's own scoring engine. Client Success
  itself was not rebuilt; only the existing `project` health component
  slot's own input source changed from "always unavailable" to "a real
  provider." See `tests/unit/lib/crm/client-success.test.ts`'s own
  `evaluateProjectHealth` suite for the full behavioral spec.

## AI context

Customer 360's own AI-context service (`getCustomer360AiContext()`)
gains real, authorized, provenance-tagged Project facts (title, status,
progress, dates) in place of no seam at all — no model call, no new
retrieval system, never widening what the requesting caller could
already see. Customer Portal's own AI assistant (Build 26, deliberately
ungrounded) is UNCHANGED — it still receives no Project data, matching
its own already-frozen boundary.

## Authorization

`delivery_projects.read` (PLATFORM, day-to-day visibility — granted via
`PLATFORM_FULL`, matching `crm.read`'s own precedent),
`delivery_projects.manage` (create/edit/lifecycle for projects/
milestones/tasks/dependencies/templates/comments/attachments),
`delivery_projects.qa` (record QA outcomes — separate authority, real
separation of duties), `delivery_projects.approve` (decide approval
requests — separate authority, the permission-level half of the
self-approval guard). Deliberately NOT keyed `projects.*` — that
namespace was already claimed by a pre-existing, still-unbuilt
ORGANIZATION-scope reserved placeholder from Module 05's original spec
section 8 catalog (`projects.read`/`.create`/`.update`/`.delete`,
granted to `ORGANIZATION_FULL` and the `manager`/`member`/`viewer`/
`customer` roles for a hypothetical, entirely different per-TENANT
"Projects" feature) — reusing that key string would have silently
overwritten those roles' existing grants with a mismatched PLATFORM-
scope definition. See `permissions.ts`'s own `delivery_projects.read`
doc comment for the full reasoning. `platform_owner`/`platform_admin`
hold all four; `support_admin` holds `delivery_projects.read` only
(matching its own established "day-to-day visibility, no management"
pattern for every other `crm.*`/`portal.*` domain). Customer Portal
NEVER receives any of these — Portal project reads use the portal-safe
projection and existing `portal.access`/ORGANIZATION authorization
exclusively.

## RLS

Every new table: platform-owned, FORCE RLS, `organization_id =
tenant_current_organization_id() AND tenant_is_platform_context()` —
the exact `crm_client_onboardings` shape, not the "OR" shape
billing/notification tables use (Projects are staff-managed delivery
records, not customer-owned tenant data). No DELETE policy anywhere;
DELETE revoked from the restricted app role on every new table.

## Security

Codex Security Engineer (read-only, adversarial, Customer Portal
leakage review flagged HIGH PRIORITY; full report at
`.codex-tasks/project-management-security-findings.md`). 0 Critical,
2 High, 3 Medium, 2 Low — every one fixed in this same build:

- **H1 — unfinished subtasks could bypass parent/project completion.**
  `completeTask()` never checked a root task's own subtasks before
  allowing `DONE`, and project completion deliberately excludes
  subtasks from its own denominator (by design — see "Progress"), so a
  root task with an open subtask could still satisfy the project's task
  gate. Fixed: `completeTask()` now loads and checks all direct
  subtasks of a root task and rejects completion while any remain open.
- **H2 — project completion wasn't serialized against criteria-
  changing child mutations, and terminal projects stayed mutable.**
  `completeProject()`'s own project-row lock never actually serialized
  against task/QA/approval/milestone mutations, because those services
  read the project via a plain, unlocked lookup — and nothing stopped
  new required work from being added to an ALREADY-`COMPLETED` project
  afterward. Fixed: every criteria-affecting child mutation (task
  create/transition/complete/cancel, milestone create/cancel, QA
  check creation, approval request, dependency creation) now goes
  through one shared `lockMutableProject()` (`project-shared.ts`) that
  locks the owning project row FIRST, in a consistent lock order, and
  rejects outright once the project has reached a terminal status —
  the same mechanism also closes M3 below, since it's the same missing
  serialization point.
- **M1 — a forged onboarding/service-item pair could return another
  onboarding's project.** `createProjectFromOnboarding()`'s idempotent-
  return branch checked for an existing project by `sourceServiceItemId`
  alone, before verifying that id actually belonged to the locked
  onboarding. Fixed: the service-item-belongs-to-onboarding check now
  runs BEFORE the idempotency lookup, and the repository lookup itself
  additionally requires `originatingOnboardingId` to match.
- **M2 — Portal progress DTOs disclosed hidden task counts.** The
  shared `ProjectProgress` type carries `completed`/`eligible` alongside
  `percent`; returning it verbatim to the Portal let a customer infer
  how many hidden internal-only tasks exist by comparing those counts
  against the visible task list. Fixed: a new count-free `PortalProgress`
  (`{ kind, percent }` only, `src/lib/projects/progress.ts`'s own
  `toPortalProgress()`) is what Portal DTOs actually carry.
- **M3 — task completion raced prerequisite reopen / dependency
  insertion.** Closed by H2's shared lock (completion, reopen, and
  dependency insertion now all serialize through the same project-row
  lock) plus a new explicit rejection: a dependency can no longer be
  added onto an already-`DONE` dependent task (reopen it first).
- **L1 — the Portal detail lookup read the full row before the
  customer check.** `getMyProjectDetail()` called a plain `findById()`
  under the elevated platform-context transaction, then filtered in
  application code — safe in its observable behavior but an
  unnecessarily over-broad privileged read. Fixed: a new
  `findPortalVisibleProject()` puts `customerOrganizationId` and
  `status != DRAFT` directly in the query's own `WHERE`.
- **L2 — a visible task leaked a hidden milestone's UUID.** A
  customer-visible root task under a non-customer-visible milestone
  still returned that milestone's real `milestoneId`. Fixed:
  `milestoneId` is now `null` unless it belongs to a milestone that is
  ALSO in the customer-visible set.

Every fix above was re-verified against the full test suite afterward
(unit, `test:db`, and every E2E spec — see "Testing") with no
regressions.

## Concurrency

CAS (`updateMany()`-guarded) transitions for: project lifecycle
changes, task terminal transitions (DONE/CANCELLED), approval
decisions (guarded on `status = PENDING`), QA outcome recording
(guarded on `status = PENDING`). `lockMutableProject()`
(`project-shared.ts` — see "Security" H2/M3 above) is the ONE shared
serialization point for every mutation whose truth affects
`evaluateProjectCompletionCriteria()`: it locks the owning `Project`
row (`SELECT ... FOR UPDATE`) in a consistent lock order (project,
then child row) and rejects outright once the project is terminal.
Dependency creation additionally re-checks the dependent task isn't
already `DONE` before inserting. Milestone/task reordering uses the
gap-based algorithm (rare full-renumber fallback, scoped to one
project's own siblings, never a mass-table operation) and is
deliberately NOT lock-gated — reordering doesn't affect completion
truth, so it stays an ordinary read-then-write (master brief: "do not
over-lock ordinary reads").

## Audit

Reuses the centralized audit system exclusively — no `ProjectAudit`
table. Audited: project created, project lifecycle transitioned,
project completed via override, project owner changed, template
instantiated, a milestone materially changed (title/target date/
customer-visibility — not every edit), a task reopened after
completion, an approval decision, a QA outcome. NOT audited: comments,
ordinary task status changes short of reopening-after-completion,
progress reads.

## Notifications

Reuses the existing notification infrastructure exclusively — a new
`PROJECT_ACTIVITY` category (its own preference control, the same
reasoning `CRM_ACTIVITY`/`BILLING` already established for their own
domains). High-value events only: project assigned, task assigned,
task blocked, approval requested, approval completed, project
completed. Never fired on ordinary task edits/comments. No workflow
automation, no fake customer email delivery.

## Testing

Unit (pure logic, no DB): `tests/unit/lib/projects/progress.test.ts`,
`dependency-graph.test.ts`, `lifecycle.test.ts` (35 tests — zero-
denominator/cancelled-exclusion/subtask-exclusion progress math,
completion-criteria gating per gate, the REQUIRED A→B→C-then-C→A cycle
case plus 6 more cycle-graph shapes, every project/task lifecycle
transition including terminal/reopen/skip-rejection), plus the extended
`evaluateProjectHealth` suite in `tests/unit/lib/crm/client-success.test.ts`
(NOT_MEASURABLE/HEALTHY/WATCH/AT_RISK/CRITICAL, highest-severity-first
ordering).

Database integration (`npm run test:db`, real restricted-role Postgres,
`tests/integration/db/project-management-security.test.ts`): fail-
closed baseline (zero rows with no tenant context) and platform-context
tenant isolation across the full model set; DELETE denial on every
Build 27 table; every one of the 8 `RAISE EXCEPTION` relationship-
integrity branches (task↔milestone, subtask↔parent, one-level-nesting,
dependency↔project (both sides), comment/attachment↔task, PROJECT- and
MILESTONE-type approval↔project, QA↔task/milestone, template task↔
template, project↔onboarding customer/company match, source service
item↔onboarding match); every CHECK constraint (cancellation-reason-
required ×3, completion-override-reason-required, self-dependency,
self-approval, rejected-approval-reason-required, QA single-scope,
not-self-parent, date-ordering); the idempotency dual-partial-index
pair (whole-onboarding key, per-service-item key, and the CANCELLED-
exclusion re-open case); two CAS-race probes (concurrent task
completion, concurrent project completion — exactly one of two
concurrent SQL updates ever succeeds); the REQUIRED dependency-cycle
case re-verified against real, persisted rows (not just the pure
function in isolation). 29/29 passing.

Full suite: `npm test` — 535 passed, 630 skipped (DB-only, run via
`test:db`) out of 1165. `npm run test:db` — 659/659 passing (all prior
builds' DB tests plus this build's own 29), confirming no regression to
Builds 19–26's own RLS/relationship-integrity coverage.

E2E (`npm run test:e2e`, against a real `npm run build && npm run
start` server — this app's own documented E2E convention, never `next
dev`): `tests/e2e/project-management.spec.ts` (7 tests — access
control; the full operational workflow in one shared platform-admin
session: manual creation, lifecycle transitions, milestones, tasks,
one-level subtasks, dependencies including the REQUIRED cycle
rejection, a stored-XSS proof on comments, QA, an approval requiring a
genuinely different second approver — self-approval controls confirmed
absent from the UI for the requester's own request — and completion
denied-then-allowed as required work clears; onboarding handoff;
template creation and instantiation with structure snapshotting;
not-found and responsive behavior). `tests/e2e/portal-project-
management.spec.ts` (3 tests — the full customer-safe visibility
matrix in one fixture: a visible milestone/task/comment alongside a
hidden milestone/task/comment AND the specific subtle case Codex
flagged and traced safe — a customer-visible comment on a hidden task
— confirmed absent; a forged/foreign project id resolves to not-found;
a staff user with no customer organization sees an honest empty
state). `tests/e2e/project-management-accessibility.spec.ts` (14 tests
— axe-core zero-violations across the admin list/new-project/templates/
project-detail-every-tab/template-detail pages and the Portal My
Projects/detail pages, desktop+tablet+mobile, light+dark). All 24
passing; found and fixed one real defect along the way (an inline
"Instantiate from a template" link relying on `hover:underline` alone
failed axe's `link-in-text-block` contrast check — fixed with the same
default-underline convention `admin/billing/controls/page.tsx` already
established for in-paragraph links).

Full regression (same E2E run, prior builds' own suites): `customer-
360.spec.ts`/`-accessibility.spec.ts` (13+13 — the "Projects" tab
rename required updating 2 pre-existing assertions that referenced the
old combined "Projects / Support / Conversations" tab label, a real,
anticipated Build 27→24 dependency, not a regression), `client-
success.spec.ts`/`-accessibility.spec.ts` (13+13 — the real
`evaluateProjectHealth()` formula change caused no observable
regression), `client-onboarding.spec.ts` (9), `portal.spec.ts` (10 —
required removing `/portal/projects` from the "honest unavailable
states" test's own case list, since it's a real page now)/`portal-
accessibility.spec.ts` (6). All green after those two anticipated,
narrow updates.

## Codex specialist work

**Database Engineer** (background dispatch, `.codex-tasks/project-
management-db-task.txt`): all 12 models, 7 enums, both partial unique
indexes, 10 CHECK constraints, the `project_management_enforce_
relationship_integrity()` trigger function (8 branches) and its 8
trigger attachments, RLS (FORCE ROW LEVEL SECURITY + 36 policies, no
DELETE policy), and the explicit `REVOKE DELETE` statements. Every one
of its own 12 live-verification claims was independently re-checked by
Claude via direct `psql`/`prisma validate`/`migrate status` inspection
before any application code was written against it — all confirmed
correct on the first attempt (no corrections needed, unlike Builds
25/26's own DB dispatches).

**Security Engineer** (background dispatch, read-only, adversarial,
Customer Portal leakage flagged HIGH PRIORITY): 0 Critical/2 High/3
Medium/2 Low findings, all fixed by Claude afterward — see "Security"
above for the full list and fixes, and "Testing" above confirming the
fixes introduced no regression.

## Performance

No separate Codex Performance Engineer dispatch ran against this
build (see "Known limitations") — the following is Claude's own
self-review, applying the same discipline Builds 19–26's own Codex
Performance reviews already established for this codebase:

- Every list/detail composition (`getProjectDetail()`, `getTemplateDetail()`,
  `listProjectsForCustomer360()`, both Portal projection functions, the
  `/admin/projects/[id]` page's own `getCompany()`/`listAssignableUsers()`
  pair) batches its child-collection reads with `Promise.all()` — never
  a per-row query inside a `.map()`.
- Every list query is bounded (100-200 rows, matching every prior
  build's own "realistic total" assumption for this dataset's actual
  scale).
- One accepted, bounded exception: `completeTask()`'s dependency gate
  resolves each prerequisite task with its own `findById()` call inside
  `Promise.all(prerequisiteIds.map(...))` — a real N+1 shape, but N is
  a single task's own dependency count (realistically single digits,
  never unbounded), and this exact "small, genuinely bounded N, not
  worth a batched `findMany()`" tradeoff already has precedent
  elsewhere in this codebase.
- `getProjectHealthInputForCustomer360()` (the Client Success
  integration) issues exactly 3 queries total regardless of how many
  ACTIVE/ON_HOLD projects a customer has (one project list, one batched
  task list, one batched QA-check list) — never one query per project.

## Known limitations

- **No dependency removal.** `project_task_dependencies` has no DELETE
  grant (the same platform-wide no-DELETE discipline every Build 27
  table follows) and no soft-remove flag in this schema. A dependency
  created in error cannot currently be un-created — a real, deliberate
  limitation, not an oversight; a future build could add a `removedAt`
  column if this proves to matter operationally.
- **No per-service-item project creation in the UI.** `createProjectFromOnboarding()`
  fully supports one project per sold service item
  (`sourceServiceItemId`) at the service layer, with its own dedicated
  partial unique index — but `/admin/projects/new`'s own form only
  exposes the "whole onboarding" path, to keep this build's first
  operational workflow simple. Wiring the per-item picker into the UI
  is a narrow follow-up, not a missing capability.
- **No dedicated project activity/timeline tab.** Every material action
  in this domain is still audited (see "Audit") and readable through
  the existing platform audit log (`/admin/audit`, filterable by
  resource) — this build did not duplicate that into a second,
  per-project timeline UI, matching "prioritize one excellent
  operational workflow" over building every panel the master brief
  named.
- **One operational view, not three.** `/admin/projects` is a filtered
  list + tabbed detail page — no separate Board (Kanban) or Timeline
  (Gantt) view exists yet. The underlying data (status, sortOrder,
  dates) supports building either later without a schema change.
- **`BTRIM()`'s own whitespace-only quirk.** Every `NULLIF(BTRIM(...), '') IS NOT NULL`
  required-reason CHECK constraint in this codebase (cancellation
  reasons, override reasons, rejection reasons) trims ONLY space
  characters by default, not tabs/newlines — a reason consisting solely
  of a tab character would technically pass. This is a pre-existing,
  accepted platform-wide convention (not introduced by this build); see
  the DB integration test's own comment for where this was explicitly
  verified rather than mis-tested.
- **No real file storage.** `ProjectAttachment.fileKey` is reserved for
  a real `StorageProvider` (Roadmap Module 56) and always `null` in
  this build — attachments are metadata plus an optional `https://`
  link to an already-hosted file, never an uploaded file. See
  "Attachments" above.
- **`lockMutableProject()` is not yet threaded through comments/
  attachments.** Codex Security Engineer's H2 fix locks the owning
  project row for every mutation that affects `evaluateProjectCompletionCriteria()`
  — comments and attachments don't affect that evaluation, so they were
  deliberately left on their own lighter-weight ownership check (master
  brief: "do not over-lock ordinary reads"). A comment/attachment can
  therefore still be added to an already-`COMPLETED` project — an
  intentional choice (it's a record, not new required work), not an
  oversight.
- **No dedicated performance review pass.** Every list/detail
  composition in this build batches its own child-collection reads with
  `Promise.all()` (never a per-row N+1) and every list query is bounded
  (100-200 rows), matching the discipline Builds 19–26 already
  established — but no separate Codex Performance Engineer dispatch ran
  against this build specifically (see "Performance").

## Future Task/Service module integration

Roadmap Module 22 (Task Management) is expected to read/aggregate
`ProjectTask` across projects for personal/team views, not replace it
(see "Project tasks" above). Roadmap Module 23 (Service Management)
will eventually replace `sourceServiceItemId`'s current
`CrmClientOnboardingServiceItem` provenance with a canonical service
record reference — `Project`'s own field is the seam Module 23 can
extend/redirect later without restructuring `Project` itself.
