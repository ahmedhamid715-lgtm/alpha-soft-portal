# Service Management

Build 29 — Roadmap Module 23. The canonical operational service spine
for Alpha OS: what Alpha Page Rankers can deliver (`ServiceDefinition`)
and what one real customer actually has (`CustomerService`). This is
the bridge between Sales → Proposal → Contract → Onboarding →
operational delivery (Projects, Tasks, and the future specialist
delivery modules). Roadmap Module 24 (SEO OS) is next and was **not**
started by this build.

## Canonical Module 23 scope

No committed 70-module roadmap document exists anywhere in this repo
(confirmed again this build, same finding every prior module's own
memory documents). The master build authorization for this module was
extremely detailed and treated as authoritative in its place — every
scope boundary below traces back to an explicit instruction in it, not
an inference.

## Core domain principle

```
ServiceDefinition (catalog: "what we can deliver")
      ↓
CustomerService (engagement: "what this customer actually has")
      ↓
Operational delivery
      ├── Projects (Build 27, existing)
      ├── Tasks (Build 28, existing — via Projects/InternalTask, never a ServiceTask)
      └── future specialist delivery modules (Roadmap 24–29)
```

Historical commercial provenance (immutable, never rewritten):

```
Accepted CrmProposalLineItem (Build 22)
        ↓ sourceLineItemId (SetNull)
CrmClientOnboardingServiceItem (Build 23)
        ↓ sourceOnboardingServiceItemId (SetNull)
CustomerService (Build 29)
```

A `ServiceDefinition` changing later NEVER rewrites an already-created
`CustomerService`, and a `CustomerService` NEVER rewrites the immutable
proposal/onboarding snapshots it was provisioned from.

## Build 19–28 reuse

- **Build 19 (CRM)**: `CrmCompany` is the canonical customer identity;
  `CustomerService.companyId` always references it, validated (via the
  relationship-integrity trigger) to actually be converted to
  `customerOrganizationId`.
- **Build 22 (Proposals & Contracts)**: `CrmProposalLineItem` stays the
  immutable commercial snapshot. Service Management never adds a second
  price field — see "Pricing boundary."
- **Build 23 (Client Onboarding)**: `CrmClientOnboardingServiceItem` is
  the direct provisioning source. `CrmClientOnboarding.linkedOrganizationId`/
  `companyId` are the values the relationship-integrity trigger checks
  a `CustomerService`'s own `customerOrganizationId`/`companyId` against.
- **Build 24 (Customer 360)**: the "Services" section now prefers real
  `CustomerService` rows, falling back to the exact same
  onboarding/accepted-proposal snapshot precedence Build 24 itself
  established — see "Customer 360 integration."
- **Build 25 (Client Success)**: `evaluateServicePerformance()` —
  already `NOT_MEASURABLE` with an explicit comment naming this exact
  module — is **untouched**. See "Service Performance boundary."
- **Build 26 (Customer Portal)**: `/portal/services` upgraded to a real
  customer-safe `CustomerService` projection, with the same
  onboarding/proposal fallback Build 26 itself established, never
  regressed.
- **Build 27 (Project Management)**: `Project.sourceServiceItemId` was
  an explicit, documented future seam for this exact module. A new,
  separate, additive `Project.customerServiceId` (nullable) is added —
  see "Project Management integration." `Project.sourceServiceItemId`
  is untouched.
- **Build 28 (Task Management)**: no `ServiceTask` — see "Task
  Management boundary."

## ServiceDefinition

The platform's own service catalog — `organizationId` is always the
PLATFORM organization (same convention every `crm_*`/`project_*` table
already uses; a `ServiceDefinition` is Alpha Page Rankers' own
operational record, never a customer organization's own data).

Fields: `name` (display), `code` (stable, unique-per-org short
reference — e.g. `"SEO-CORE"` — the durable key future specialist
modules and integrations key off; never a display label that can
drift), `description`, `category` (see below), `deliveryCadence` (see
below), `sortOrder`, `status` (`ACTIVE`/`ARCHIVED` — a simple two-state
lifecycle, no state-machine table needed for two states with one edge
each way).

Deliberately excluded (see the relevant boundary sections below):
Stripe subscription ids, invoice pricing, tax configuration, SEO
keywords, GBP profile configuration, website credentials, project task
templates, commission rates — none of these are canonically owned
here.

### Service categories

A closed Postgres **enum** (`ServiceCategory`: `SEO`, `LOCAL_SEO`,
`WEB_DEVELOPMENT`, `ECOMMERCE`, `GHL_AUTOMATION`, `CREATIVE`, `OTHER`)
— not a dynamic category table (would be "an enterprise taxonomy
platform" for a handful of durable, rarely-changing values — explicitly
warned against) and not brittle string-matching against `name`
(`if (service.name.includes("SEO"))` is exactly the failure mode
avoided). A stable enum is the same "durable capability key future
modules switch on" pattern `TaskSourceType` (Build 28) already
establishes. Extending it requires a real migration, the same
governance every other enum in this codebase already has — a
deliberate, not accidental, friction point.

### Delivery cadence

`ServiceDeliveryCadence`: `ONE_TIME` | `RECURRING` | `ONGOING` — a pure
**operational classification**, never billing/scheduling logic. No
invoice generation, no recurring Stripe subscription creation, no
scheduled tasks, no automatic renewal — those remain source-domain
(Billing/future Workflow Automation) responsibilities untouched by this
build.

## CustomerService

One real operational service engagement for one real customer —
genuinely different from `ServiceDefinition`, never conflated. Fields:
`customerOrganizationId`, `companyId`, `serviceDefinitionId` (always
set — see "Unmapped historical services" for what "unmapped" actually
means), `sourceOnboardingServiceItemId` (nullable — see "Commercial
provenance"), `quantity`, `status` (lifecycle, see below),
`ownerUserId` (nullable, validated active platform staff),
`startDate`/`targetEndDate`/`activatedAt`/`pausedAt`/`completedAt`/
`cancelledAt`+`cancelledReason`+`cancelledByUserId`.

No `renewalDate` field — Build 25's own `CrmClientSuccessRenewal`
already owns renewal tracking against `Contract`; duplicating it here
was evaluated and rejected as genuinely unowned by this module.

## Definition vs. customer engagement — why two models

`ServiceDefinition` answers "what could we sell/deliver." `CustomerService`
answers "what does THIS customer actually have, right now, operationally."
Editing a `ServiceDefinition`'s name/description/category later never
retroactively changes any existing `CustomerService`'s own historical
facts — the FK reference (`serviceDefinitionId`) is live (not a
snapshot copy) for catalog display purposes (current name/category
should show current catalog truth), but the `CustomerService` row
itself — its status, dates, ownership, provenance — is the
`CustomerService`'s own independent history, never overwritten by a
catalog edit.

## Commercial provenance — the honest chain

`CustomerService.sourceOnboardingServiceItemId` is the ONLY direct
provenance field. It is NOT duplicated forward from
`CrmClientOnboardingServiceItem.sourceLineItemId` — the full chain
(line item → proposal version → proposal → deal → contract) stays
reachable by walking through the onboarding service item's own already-
existing relations, never denormalized onto `CustomerService` itself.
`NULL` means manually created — no separate boolean flag was added
(the nullable FK alone is the honest signal, same discipline
`CrmContract`'s own dual-null-or-dual-set origin fields establish).

## Unmapped historical services

Existing onboarding service items predate this module and may not map
cleanly to any `ServiceDefinition`. There is **no fuzzy matching, no
auto-creation of a definition from arbitrary historical line-item
text**. "Unmapped" is not a field on anything — it's simply: an
onboarding service item with NO `CustomerService` row referencing it
yet (queried directly, `crmClientOnboardingServiceItemRepository.
listUnprovisioned()`). Provisioning IS the explicit mapping act — an
operator picks a real `ServiceDefinition` and calls
`createCustomerServiceFromOnboardingServiceItem()`; there is no
intermediate "partially mapped" state. The original sold-service title/
description stays visible and untouched throughout.

## Provisioning

`createCustomerServiceFromOnboardingServiceItem()` — the one
controlled operation this build introduces for this handoff:

1. `resolveDeliveryServiceScope("delivery_services.manage")`.
2. Lock/load the onboarding service item; validate it belongs to this
   platform organization.
3. Load its parent onboarding; verify `linkedOrganizationId`/`companyId`
   match what's about to be written (defense in depth on top of the DB
   trigger).
4. Validate the target `ServiceDefinition` is real, platform-owned, and
   `ACTIVE`.
5. Idempotency check (see below) — a repeat call returns the existing
   row rather than erroring or duplicating.
6. Validate `ownerUserId` (if supplied) is active platform staff.
7. Create the `CustomerService`, audit, notify only on real assignment.

Transaction-safe (one `withTenantContext()` transaction), retry-safe
and cross-tenant-safe (every id is independently re-validated against
the resolved platform organization, never trusted from client input
alone).

## Idempotency

A repeated call for the same onboarding service item must not create a
duplicate. Protected at the DATABASE level, not merely
`if (!existing) create()`:

```sql
CREATE UNIQUE INDEX customer_services_one_active_per_source_item
  ON customer_services(source_onboarding_service_item_id)
  WHERE source_onboarding_service_item_id IS NOT NULL AND status != 'CANCELLED';
```

A cancelled provisioning does not permanently block a fresh attempt —
same reasoning `projects_one_active_per_service_item` (Build 27)
already establishes for the identical class of problem. Verified live
under real concurrent `Promise.all()` requests, not just asserted.

## Manual customer service creation

Supported explicitly — an operator may create a `CustomerService` with
no proposal/onboarding provenance at all (`sourceOnboardingServiceItemId:
null`). Requires: a real, ACTIVE customer `Organization`; a real
`CrmCompany` already converted to EXACTLY that organization (the same
`resolveConsistentCompany()`-shaped check `project-service.ts`'s own
manual `createProject()` already performs — intentionally
re-implemented here rather than importing Project Management's
module-private helper, a small, stable, ~10-line duplication judged
cheaper than a new cross-domain coupling for one check); an explicit,
real, `ACTIVE` `ServiceDefinition`; authorization; audit. Provenance is
honestly `null` — never a fabricated sales history.

## Customer-service lifecycle

```
PENDING ──activate──> ACTIVE ──pause───> PAUSED
   │                     │  <──resume───   │
   │                     │                 │
   └──cancel──> CANCELLED <──cancel────────┘
                    ▲
                    │ (no outgoing transitions — harder stop than COMPLETED)
                     
ACTIVE ──complete──> COMPLETED ──reopen──> ACTIVE
```

`src/lib/services/lifecycle.ts` (`canTransitionCustomerService()`) is
the pure, server-authoritative table — the UI is never lifecycle
authority. `COMPLETED → ACTIVE` (reopening) is intentionally allowed,
same reasoning `ProjectStatus`'s own identical edge documents. `CANCELLED`
has zero outgoing transitions — a genuinely harder stop than completion;
there is no "un-cancel," provision a fresh `CustomerService` instead
(which the idempotency index above explicitly allows once the
cancelled row no longer blocks it). Every transition is additionally
CAS-guarded at the repository layer (`updateMany()` with a status-guard
`WHERE`, mirroring `CrmTask`/`InternalTask`'s own established idiom —
no heavier row-lock helper was needed here, since — unlike `Project` —
`CustomerService` has no child-table completion-criteria calculation
whose staleness a lock would need to protect).

Cancellation requires a non-blank reason (CHECK constraint, same
`NULLIF(BTRIM(cancelled_reason), '') IS NOT NULL` idiom every terminal-
state-with-reason column in this codebase already uses).

## Activation semantics

`ACTIVE` means the service engagement is operationally active **in
Alpha OS only**. It does NOT imply an SEO campaign was provisioned
externally, a GHL workflow was created, a website was deployed, a
payment succeeded, a subscription activated, or that the customer
received an email — none of those authoritative systems are
consulted or asserted by this status.

## Ownership

`ownerUserId` references an existing `User` — no new
`ServiceEmployee`/`ServiceUser`/`AccountSpecialist` model. New
assignments are validated via `assertPlatformStaffMember()` (Build 19,
already reused identically by Build 28's own `InternalTask`), which
requires an ACTIVE platform-organization membership. A historically
inactive owner remains visible — deactivation never clears the FK.

## Dates

`startDate`/`targetEndDate` are informational only — never derived from
price or template text, and obviously invalid ranges are rejected at
the service layer (`targetEndDate` before `startDate`). All UTC/
`Timestamptz(3)`, same platform-wide convention.

## Pricing boundary

**No price field exists anywhere in Service Management.** Historical
price is already preserved, immutably, in `CrmProposalLineItem`
(`unitAmountMinorUnits`/`lineTotalMinorUnits`) — duplicating it here
would create a second, driftable "price" with no clear authority.
`CustomerService` references provenance (transitively reaching the
real historical price if ever needed) rather than copying a mutable
number forward.

## Billing boundary

No invoices, payments, subscriptions, credits, tax logic, or Stripe
operations were created or touched. `Plan`/`Subscription` (Build 13/14)
model Alpha Page Rankers' own SaaS retainer tiers billed to customers —
a genuinely different, non-overlapping concept from `ServiceDefinition`
(confirmed by inspection; zero existing overlap). No link between
`CustomerService` and `Subscription`/`SubscriptionItem` was added — the
master authorization is explicit that this integration should only
happen "if existing billing architecture provides a real safe
relation," and forcing one prematurely was rejected. A future seam, not
built.

## Project Management integration

One additive, nullable `Project.customerServiceId` FK (`SetNull` on
delete) — `Project.sourceServiceItemId` is completely untouched.
Cardinality: **one `CustomerService` may have MANY `Project`s** (a
service can realistically span multiple delivery projects over its
lifetime — e.g. an initial build project and a later redesign project
for the same ongoing website service); **one `Project` references AT
MOST ONE `CustomerService`** — the identical single-nullable-FK
provenance shape `sourceServiceItemId` already uses, not a join table
(no evidence a project ever needs to deliver multiple services
simultaneously; the simpler cardinality was chosen deliberately, not
assumed).

Service Management **never inserts a `Project` row directly** —
`customerServiceId` is threaded through as an additional optional
parameter on Project Management's own existing creation functions
(`createProject()`, `createProjectFromOnboarding()`), which independently
validate it (a supplied `customerServiceId` must belong to the same
platform organization and the same `customerOrganizationId`/`companyId`
pairing being used to create the project) before persisting — Project
Management remains fully authoritative for every Project mutation and
invariant.

## Task Management boundary

No `ServiceTask` was created. Operational work for a service surfaces
exclusively through its linked `Project`s' own already-existing task
structure (Build 27) or `InternalTask` (Build 28) — never a fifth task
system. A `CustomerService` detail page displays its linked projects
(deep-linking to their own authoritative detail pages) rather than a
raw task list, avoiding any new cross-cutting Task Management filter.

## Service operational status vs. Service Performance — critical distinction

`CustomerService.status` (`ACTIVE`/`PAUSED`/...) is an **operational
lifecycle fact**. It is NOT a performance judgment. A service can be
`ACTIVE` while performing poorly; a service can be `PAUSED` without
being "unhealthy." This build makes operational state real and
queryable — it does **not** fabricate a performance score.

## Service Performance boundary

`evaluateServicePerformance()` (`src/lib/crm/client-success.ts`) —
already `NOT_MEASURABLE`, with an explicit pre-existing comment naming
this exact module — is **left completely untouched** by this build.
No specialist KPI provider exists yet (Roadmap 24–29 own that), and the
master authorization explicitly warns against letting "missing
specialist metrics" count as a bad score. Client Success's Build 25
health formula is otherwise entirely unmodified — no re-freezing was
necessary since nothing in it changed.

## Customer 360 integration

`resolveServices()` (Build 24, `customer-360-service.ts`) is extended
with a new precedence tier, checked FIRST: real `CustomerService` rows
for this company (if any exist) → the exact same onboarding-snapshot
fallback → the exact same accepted-proposal-snapshot fallback Build 24
already established. Customer 360 never queries `service_definitions`/
`customer_services` directly — it calls a new Service Management
domain function, the same "composition layer owns no persistence of
its own" discipline every other Customer 360 section already follows.

## Customer Portal integration

`/portal/services` (Build 26) is upgraded from onboarding/proposal-
snapshot-only to a real, customer-safe `CustomerService` projection —
`source: "canonical"` is a new, higher-precedence tier ahead of the
exact same `"onboarding"`/`"accepted_proposal"`/`"none"` fallback Build
26 already established (never regressed — a customer with zero
canonical `CustomerService` rows still sees their existing snapshot
view exactly as before).

### Customer-safe projection

A dedicated `PortalCustomerService` DTO — never the internal
`CustomerService` model with fields hidden client-side. Included:
service name, customer-safe description, status, start/target dates,
and linked customer-visible project titles (bounded). Excluded:
internal owner identity, internal notes/configuration, internal health/
risk flags, margins/profitability, internal tasks, audit data,
specialist credentials, sales metadata.

### Portal security

Portal uses ORGANIZATION-scoped authorization (`requirePermission(
"portal.access", organizationId)`) — completely independent of
`delivery_services.*`, which is never granted to a customer-portal
identity. Every query is scoped by the ALREADY-VERIFIED
`organizationId`, re-proven per row (`customerOrganizationId` must
equal the resolved org), the same IDOR-safe convention every other
Portal projection in this codebase already establishes. A forged/
foreign `CustomerService` id resolves the same way a nonexistent one
does.

## Authorization

Checked against the real permission catalog before naming anything —
`services.*`/`delivery_services.*` were both unclaimed (unlike
`projects.*`, which Build 27 found already reserved for a dormant,
different concept). `delivery_services.*` chosen deliberately for
consistency with `delivery_projects.*`, not merely because it was free.

| Key | Grants |
|---|---|
| `delivery_services.read` | View the catalog and customer service engagements |
| `delivery_services.manage` | Provision/edit/transition customer service engagements |
| `delivery_services.catalog_manage` | Create/edit/archive `ServiceDefinition` rows |

`platform_owner`/`platform_admin` hold all three; `support_admin` holds
only `delivery_services.read` (day-to-day visibility while helping a
customer, not catalog authority or lifecycle control) — same tier
pattern `delivery_projects.*`/`task_management.*` already establish for
these exact three roles.

### Source authorization

`delivery_services.read` never widens visibility into Proposal/
Onboarding/Project internals — it only grants access to Service
Management's OWN two tables. Provenance display (e.g. showing the
originating onboarding service item's own title) reads through
Service Management's own already-authorized query, never bypasses the
source domain's own permission for anything beyond that bounded,
already-immutable snapshot text.

## RLS

Both `service_definitions` and `customer_services`: `ENABLE` + `FORCE
ROW LEVEL SECURITY`, three policies (SELECT/INSERT/UPDATE) requiring
`organization_id = tenant_current_organization_id() AND
tenant_is_platform_context()`, no DELETE policy, explicit `REVOKE
DELETE ... FROM alpha_os_app` — the identical `internal_tasks` (Build
28) shape.

## Relationship integrity

One new trigger, `customer_services_relationship_integrity`
(`SECURITY INVOKER`, polymorphic `to_jsonb(NEW)` access, same
convention `project_management_enforce_relationship_integrity()`
already establishes), enforced on every INSERT/UPDATE:

1. If `source_onboarding_service_item_id` is set: its parent
   onboarding's own `linked_organization_id`/`company_id` must equal
   this row's `customer_organization_id`/`company_id`.
2. **Independently, unconditionally** (holds even for a manually
   created row with no source item at all): `company_id`'s own
   `converted_to_organization_id` must equal `customer_organization_id`
   — the real cross-tenant boundary: a caller must never be able to
   pair a real `CrmCompany` with a customer `Organization` it was never
   actually converted to.

## Concurrency

Lifecycle transitions use CAS (`updateMany()` with a status-guard
`WHERE`) — the same idiom `CrmTask`/`InternalTask` already establish,
deliberately NOT the heavier `lockMutableProject()`-style row lock
Project Management needs (that lock exists specifically to protect a
completion-criteria calculation across several CHILD tables;
`CustomerService` has no equivalent child-table staleness risk).
Provisioning idempotency is a DB-level partial unique index, not an
application-level check-then-insert race.

## Security

Codex Security Engineer reviewed the full Build 29 diff read-only and
found two real, Medium-severity issues, both fixed in this build:

**SM-SEC-01 — `delivery_services.read` widened into onboarding/project
data.** `getCustomerServiceDetail()`, `listUnprovisionedOnboardingServiceItems()`,
and `listServicesForCustomer360()` each returned onboarding-domain
(item title, onboarding id) or project-domain (linked project titles/
statuses) facts to any caller holding `delivery_services.read` alone —
exactly the "aggregator widens what a caller could already see" failure
mode `docs/architecture/task-management.md`'s own "Authorization
intersection" section warns against. Fixed by checking
`crm.onboarding.read`/`delivery_projects.read` independently before
including that specific data: `getCustomerServiceDetail()` now returns
`canSeeProvenance`/`canSeeLinkedProjects` booleans (omitting the actual
onboarding/project fields when false, so the UI can render an honest
"requires X permission" message rather than silently showing nothing);
`listServicesForCustomer360()` gained the same `canSeeLinkedProjects`
field; `listUnprovisionedOnboardingServiceItems()` now throws unless
the caller also holds `crm.onboarding.read`, and the Unmapped tab is
hidden from the nav entirely (and shows an honest denial state on
direct navigation) for a caller who lacks it.

**SM-SEC-02 — owner validation ignored global `User.status`.**
`assertPlatformStaffMember()` (Build 19, `crm-shared.ts`, reused
unchanged by every owner-accepting path here) checked only that an
`OrganizationMembership` was `ACTIVE` — never the underlying `User`'s
own global status. Global suspension/deactivation deliberately leaves
memberships untouched, so a globally disabled account could still be
assigned a service (and receive the resulting notification email with
customer/service content). Fixed in the shared function itself
(benefiting every existing caller, not just Service Management):
rejects `SUSPENDED`/`DEACTIVATED` users specifically — deliberately
NOT `INVITED` (a real staff member who simply hasn't completed their
first sign-in is still legitimately assignable, and over-rejecting
`INVITED` broke a genuine pre-existing Build 19 test fixture during
verification, confirming the narrower check is the correct one).
`listAssignableUsers()` got the identical filter, so the owner picker
never offers an account its own assignment check would then reject.

SM-SEC-02 is regression-tested by a dedicated E2E test
(`tests/e2e/service-management.spec.ts`, "Codex Security Engineer
finding SM-SEC-02") proving a real SUSPENDED platform-org member never
appears in the owner picker. SM-SEC-01's fix was verified by manual UI
testing during the fix itself, but is NOT exercised by an automated
regression test — see "Known limitations" for why (every currently
seeded role holding `delivery_services.read` also holds the two
co-permissions, so the denial branch this fix added has no live
account to trigger it against today; it is defense-in-depth for a
future role shape, not a currently reachable path).

Beyond these two, Codex traced and confirmed CORRECT (with file:line
citations in `.codex-tasks/service-management-security-report.md`):
cross-tenant `customerOrganizationId`/`companyId`/`serviceDefinitionId`
consistency cannot be desynchronized after creation by any exposed
mutation; `delivery_services.manage` never bypasses
`delivery_projects.manage` for Project creation; Portal reads are
strictly bound to the caller's own already-verified organization (no
IDOR); every lifecycle transition is race-safe (CAS + row lock, no
read-then-write gap); the idempotency partial unique index is the real
structural guarantee, not merely application logic; no Zod schema or
Server Action accepts a field it shouldn't (organizationId,
createdByUserId, id, status, completedAt); the one raw SQL statement
(`findByIdLocked()`'s `SELECT ... FOR UPDATE`) is parameterized, not
injectable.

## Audit

Reuses the centralized `AuditEvent` — no `ServiceAudit`. Action key
namespace is `services.*` (distinct from the `delivery_services.*`
PERMISSION namespace, same split `tasks.*`/`task_management.*` and
`projects.*`/`delivery_projects.*` already establish), category `CRM`
(same precedent `projects.*` established — Service Management sits in
the same commercial/delivery domain family, unlike Task Management's
own genuinely administrative `InternalTask`, which reused
`ADMINISTRATION`).

## Notifications

One new category, `SERVICE_ACTIVITY` (mirrors `PROJECT_ACTIVITY`/
`TASK_MANAGEMENT_ACTIVITY`). Three high-signal events only: owner
assignment, activation, completion — deliberately NOT pause/resume
(routine operational adjustments, not "needs your attention" facts).

## Performance

Standard server-side offset pagination on both list endpoints — no
UNION architecture (Build 28's own centerpiece decision) was needed or
copied; Service Management is two straightforward single-table
domains, not a cross-source aggregator. Codex Performance Engineer's
own verdict on the shape of the code: "an ordinary well-indexed CRUD
list" — no cross-source fan-out, no unbounded query, no missing
`LIMIT`.

Two real findings, both fixed:

**N+1 in Customer 360 and Portal service enrichment (Medium).**
`listServicesForCustomer360()` and `getPortalServices()`'s canonical
tier each originally called `projectRepository.listForCustomerService()`
(and, in the Portal path, `serviceDefinitionRepository.findById()`)
once per `CustomerService` row in a loop — fine for the single-record
detail view this method was first written for, but on a list view
showing N services that becomes N additional round-trips per page
render. Fixed by adding a genuinely batched repository method,
`projectRepository.listForCustomerServices(customerServiceIds: string[])`,
that issues one `WHERE customerServiceId IN (...)` query and groups
the results in memory by id; the Portal path additionally batches
`ServiceDefinition` lookups with a single `findMany({ where: { id: {
in: definitionIds } } })`. Both call sites now do a fixed 2–3 queries
regardless of list size.

**Missing composite index for the organization-scoped list order
(Low).** `customerServiceRepository.listForOrganization()` orders by
`(organizationId, createdAt DESC, id)` for stable keyset-safe
pagination, but the only existing index on `customer_services` covered
`organizationId` alone — every page beyond the first required a sort
of the full per-organization row set. Fixed with a dedicated
migration (`20260911040000_service_management_index_tuning`) adding
`customer_services_organization_id_created_at_id_idx` on exactly that
column order, matching the query's own `ORDER BY` clause so Postgres
can walk the index directly instead of sorting.

Confirmed clean elsewhere (file:line citations in
`.codex-tasks/service-management-performance-report.md`): both list
endpoints cap at bounded page sizes with real `LIMIT`/`OFFSET`, no
endpoint loads an unbounded set into memory to filter/sort in
application code, the idempotency check (`findActiveForSourceItem`)
and the CAS lifecycle updates are each single indexed queries, and
`findByIdLocked()`'s row lock is scoped to exactly one row, never a
range.

## Accessibility

`tests/e2e/service-management-accessibility.spec.ts` runs a full axe
sweep across every new surface — the catalog list/create/edit views,
the customer-service list/detail/provision/manual-create views, the
Unmapped tab, and the Portal `/portal/services` canonical tier — at
light and dark themes and at desktop/tablet/mobile viewports, plus
keyboard-only operation of the lifecycle action buttons, the owner
`<select>`, and the cancellation-reason form. 13/13 tests pass with
zero axe violations. Status is never communicated by color alone:
every `StatusBadge` carries its status as visible text
(`customerServiceStatusVariant()`/`serviceDefinitionStatusVariant()`
only pick the color, not the label).

## Testing

- **Unit** — 8 tests for the lifecycle state machine
  (`tests/unit/lib/services/lifecycle.test.ts`: every legal transition,
  every illegal transition, terminal-status set) and 4 for the display
  helpers (`tests/unit/components/services/service-status.test.ts`).
- **Live-database integration** — 14 tests
  (`tests/integration/db/service-management-security.test.ts`) run
  against the real `alpha_os_app` restricted role: relationship-
  integrity trigger (accepts a consistent chain, rejects a wrong-org
  company, rejects an unconverted company), idempotency (partial
  unique index rejection, a CANCELLED row not blocking a retry, a real
  concurrent-insert race), CHECK constraints, RLS (fail-closed with no
  tenant context, a bare customer session seeing only its own
  organization's rows, DELETE denied outright), the full CAS lifecycle
  path, a rejected double-transition, and a concurrent-completion
  race.
- **E2E** — 25 tests across three files: `service-management.spec.ts`
  (9 — access control for support-agent/support-admin, full
  ServiceDefinition CRUD + archive/reactivate, unmapped → provision →
  duplicate-prevention, the full PENDING→ACTIVE→PAUSED→ACTIVE→
  COMPLETED→ACTIVE lifecycle, cancel-requires-reason, not-found
  handling, responsive behavior, and the SM-SEC-02 regression test),
  `portal-service-management.spec.ts` (3 — canonical service visible
  with customer-safe fields only, a foreign organization's service
  never leaks, an honest empty state for a staff member with no
  customer organization), and `service-management-accessibility.spec.ts`
  (13, described above).
- **Regression** — the full prior-build E2E suite was re-run after
  these changes: `authorization.spec.ts` + `crm.spec.ts` +
  `project-management.spec.ts` together (23/23 passing, confirming the
  new permissions and the `Project.customerServiceId` seam didn't
  disturb existing authorization or project flows).

## Migration / backfill strategy

No risky all-history migration. Every new relationship is nullable and
additive. Existing onboarding service items are left exactly as they
are — visible via the explicit "unmapped" query, provisioned only
through a deliberate operator action, never auto-mapped or guessed.

## Known limitations

- **DB-integration/next-auth import boundary.** Plain Vitest DB tests
  (`tests/integration/db/*.test.ts`) cannot import any service-layer
  file that transitively pulls in `requirePermission()`/next-auth
  session machinery — there is no Next.js bundler in that test
  environment to resolve it. This means SM-SEC-02's fix
  (`assertPlatformStaffMember()`'s SUSPENDED/DEACTIVATED check, in
  `crm-shared.ts`) is regression-tested at the E2E layer
  (`service-management.spec.ts`) rather than the DB layer, unlike this
  module's other authorization-adjacent properties. This is a
  pre-existing environment boundary (not introduced by Build 29) now
  documented inline in the DB test file for future builds.
- **Shared-fixture-organization test interaction (real, permanent, by
  design).** `service-management.spec.ts` and
  `portal-service-management.spec.ts` deliberately provision real
  `CustomerService` rows against the shared `acme-corp-dev` ("Acme
  Corp"/`owner-a@alpha-os.test`) test organization that
  `customer-360.spec.ts` and `portal.spec.ts` also use as their own
  fixture account — and because `CustomerService` rows are
  permanently undeletable through the application (no DELETE RLS
  policy, a deliberate provenance-preservation decision), any local
  dev database where the Service Management E2E suite has ever run
  will forever afterward show the canonical tier for Acme Corp's
  Customer 360/Portal services view instead of the onboarding/
  proposal fallback those older specs' own assertions were written
  against. This is correct product behavior (a real customer with a
  provisioned service should show that service, not a stale
  commercial snapshot) surfacing as a test-fixture collision, not a
  runtime defect — confirmed harmless to production by tracing that no
  `Project` or other table ever referenced the specific test rows this
  build's own iterative debugging left behind (verified before they
  were removed from the local dev database to restore a clean
  regression baseline). A future build should consider giving Service
  Management's own E2E fixtures a dedicated, disposable customer
  organization instead of reusing Acme Corp, to avoid this recurring.
- **ServiceDefinition catalog has no soft "draft" state.** A
  definition is either ACTIVE or ARCHIVED — there is no third
  "not yet published" status. Master prompt guidance treated this as
  out of scope (no evidence a multi-step publishing workflow is
  needed yet); a definition created by mistake is archived, not
  hidden pre-publication.
- **SM-SEC-01's gating has no automated regression test.** The fix
  (`canSeeProvenance`/`canSeeLinkedProjects` in
  `getCustomerServiceDetail()`, the equivalent gate in
  `listServicesForCustomer360()`, and the `crm.onboarding.read` guard
  in `listUnprovisionedOnboardingServiceItems()`) is real
  defense-in-depth, but in the CURRENT role catalog every role that
  holds `delivery_services.read` (`platform_owner`, `platform_admin`,
  `support_admin`) also holds `crm.onboarding.read` and
  `delivery_projects.read` — so no seeded account can currently reach
  the denial branch, and there is no automated test proving it renders
  correctly. It was verified manually during the fix. A future role
  that grants `delivery_services.read` alone (a plausible "services
  read-only" support role) would be the first to actually exercise
  this path, and should add E2E coverage for it at that point.
- **No specialist-module KPI providers exist yet.** As required by the
  master prompt's own rule 3, Service Performance is `NOT_MEASURABLE`
  everywhere — this is intentional and will only change once a
  Roadmap Module 24–29 specialist system exists to report real
  performance data; Service Management itself defines no interim or
  placeholder metric.

## Future Roadmap Module 24–29 compatibility

`ServiceCategory` is the durable, typed key a future SEO OS / GBP OS /
Website Development OS / E-Commerce OS / GHL Automation OS / Creative
Services module should switch on to find "its own" `CustomerService`
rows, never string-matching against `name`. None of those specialist
systems were built here — Service Management provides only the common
spine (catalog + engagement + lifecycle + provenance + Project
linkage) they attach to.
