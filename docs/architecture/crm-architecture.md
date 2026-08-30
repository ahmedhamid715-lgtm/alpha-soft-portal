# CRM architecture

Build 19 implements Canonical Roadmap Module 13 — CRM. Source comments call
this "Module 19" where they refer to the repository build number; the roadmap
capability remains Module 13.

## Purpose and boundary

CRM is Alpha Page Rankers' internal prospect and sales-workspace foundation.
It contains companies, contacts, leads, immutable activities, and bounded
follow-up tasks. It is not customer-tenant CRM, the Sales Pipeline module,
client onboarding, or a general task/custom-fields engine.

The implementation follows the repository's normal layers:

1. Server Components render platform-admin CRM routes.
2. Client forms call thin Server Actions in the CRM route tree.
3. Services parse input, resolve authorization, enforce lifecycle and
   relationship rules, and open a tenant-scoped transaction.
4. Repositories contain Prisma persistence and bounded query shapes.
5. PostgreSQL RLS and relationship-integrity triggers provide the final data
   isolation layer through the restricted application role.

## Data model

`CrmCompany` is a prospect or customer record in the sales workspace. It is
not an Alpha OS `Organization`. An `Organization` is a real tenant and access
boundary; a CRM company has no login, membership, or tenant authority.
`convertedToOrganizationId` is reserved for an explicit future onboarding
handoff and is not populated automatically by Build 19.

`CrmContact` is a person at one CRM company. It is not a `User`: users are
authenticated Alpha OS identities, while contacts cannot sign in and never
receive authorization.

`CrmLead` belongs to one company and may reference a primary contact, lead
source, and platform-staff assignee. The primary contact must belong to the
same company. Lead sources are retained and toggled active/inactive rather
than deleted.

`CrmActivity` is an append-only note, call, email, meeting, or service-created
status-change record attached to exactly one lead, company, or contact.
Activities have SELECT/INSERT policy and privilege only; corrections are new
activities, never edits to history.

`CrmTask` is attached to exactly one CRM entity. Task transitions are
`OPEN -> COMPLETED` or `OPEN -> CANCELLED`; both terminal states are immutable.
Updates use an OPEN-only compare-and-swap so concurrent terminal transitions
cannot overwrite one another.

Custom-field definitions are CRM-scoped and typed as text, number, date,
boolean, or select. A value belongs to exactly one lead, company, or contact.
Select values must be configured options; numbers must fit `Decimal(20,4)`;
and the definition entity type must match the target entity.

## Tenant ownership

Every directly owned CRM row has a non-null `organizationId`. In normal
application operation that id is always the single platform organization
resolved by `resolvePlatformContext()`. Customer organization context never
receives CRM access, and no caller may provide or reassign tenant ownership.

Custom-field values are transitively owned through their definition. Database
triggers additionally require the target entity to have the same ownership as
the definition. The same trigger layer enforces tenant consistency for
contact-company, lead-company/contact/source, activity-parent, and task-parent
relationships. This closes the nested association gap that a child row's own
RLS predicate alone cannot detect.

## Lead lifecycle

The service-level state machine is:

```text
NEW -> CONTACTED -> QUALIFIED -> CONVERTED
  \       \            \-----> DISQUALIFIED
   \-------\------------------> DISQUALIFIED
```

`QUALIFIED` may be reached directly from `NEW`. Conversion and
disqualification are terminal. Disqualification requires a reason. Every
transition is a compare-and-swap and creates a `STATUS_CHANGE` activity in the
same database transaction. Conversion records `convertedAt`; it does not
create an Organization or begin Sales Pipeline/client onboarding work.

## CRM activity architecture

Activities are the durable sales chronology and are intentionally immutable.
They store only bounded text and call metadata, plus the authenticated actor.
A user cannot submit a `STATUS_CHANGE` activity directly; only the lead
lifecycle service writes one atomically with the corresponding status.

Routine activity creation is not duplicated into the general audit log. The
activity row is already the detailed business record. Security- and
lifecycle-significant company/contact/lead events use the audit subsystem.

## Task and custom-field boundaries

CRM tasks are follow-ups such as a call due on a lead. They do not implement
Roadmap Module 22's future cross-module task engine, dependencies, projects,
recurrence, or queues.

CRM custom fields extend only companies, contacts, and leads. They do not
implement Roadmap Module 64's future global field-definition engine. Build 19
provides definition/settings UI and the validated service/action boundary for
values, preserving a migration path without coupling unrelated modules.

## Authorization

Both CRM permissions have `PLATFORM` scope:

- `crm.read` views all CRM surfaces. It is granted to platform owner,
  platform admin, and support admin.
- `crm.manage` performs all CRM mutations and settings changes. It is granted
  only to platform owner and platform admin.

Support agents and customer-organization roles receive neither permission.
Every service invocation re-resolves the authenticated session, active
platform membership, role, and permission; hiding a button is never the
authorization boundary. Assignees must be active platform-organization
members, preventing internal task content from being notified to a
customer-only user.

## Row-level security

All CRM tables enable and force RLS. The restricted `alpha_os_app` role is
used by `withTenantContext()` through `APP_DATABASE_URL`; the migration-owner
connection is not accepted as RLS proof.

Directly owned rows require both:

- `organization_id = tenant_current_organization_id()`; and
- `tenant_is_platform_context()`.

Custom-field-value policies require a visible, same-context definition.
Companies, contacts, sources, leads, tasks, definitions, and values have no
DELETE policy. Activities have neither UPDATE nor DELETE policy. Matching
privilege revocations add defense in depth. Relationship-integrity triggers
run as `SECURITY INVOKER`, so their parent checks remain subject to the same
restricted tenant context.

The restricted-role suite proves no-context denial, two-tenant isolation,
forgotten-WHERE isolation, cross-tenant mutation denial, immutable activity
and delete behavior, exactly-one-parent constraints, typed custom-field
targets, and nested cross-tenant relationship rejection.

## Security

Server inputs are Zod parsed and unknown fields are stripped, preventing mass
assignment of organization, lifecycle, conversion, actor, or creator fields.
All supplied UUID relationships are resolved inside the authorized
tenant-scoped transaction. Missing or cross-tenant resources fail safely as
not found/validation errors. React renders user-controlled CRM text as text;
the production E2E attack pass includes an HTML event-handler payload.

The implemented CRM surface has no tag entity or tag-id action, so there is no
tag identifier attack surface in Build 19. Tags must not be inferred from the
unrelated platform plan/tag vocabulary; if a later roadmap module introduces
CRM tags, it needs the same tenant relationship and forged-ID tests.

## Audit and notifications

The `CRM` audit category records:

- company created/archived;
- contact created/archived; and
- lead created/status changed/converted.

Task and activity CRUD is not duplicated into audit events. The one CRM
notification is `crm.task.assigned`, delivered in-app and optionally by email
to a validated active platform staff assignee. Event payloads carry stable
IDs and bounded task titles, and delivery occurs after the task transaction.

## Search boundary

Build 19 provides tenant-scoped, case-insensitive list filtering for company
name, contact name/email, and lead title. It does not implement global search,
full-text ranking, fuzzy matching, external indexing, or Sales Pipeline
forecast search. Those remain future concerns and must preserve the same
platform-only ownership boundary.

## Accessibility

CRM uses the shared Alpha OS design system, semantic labels, keyboard-focusable
scroll regions, responsive layouts, and status labels that do not rely on
color alone. Production Playwright coverage scans all CRM routes in light and
dark themes, dense lead/settings pages at desktop/tablet/mobile sizes, empty
and validation-adjacent states, SELECT configuration, and keyboard tab
progression with axe-core. The Build 19 pass found and corrected the shared
light-theme warning-badge contrast defect without weakening axe assertions.

## Performance

Primary company/contact/lead/task lists use offset pagination with a maximum
page size of 100; UI pages request 25. Activity timelines are paginated.
Company contact rosters, assignment candidates, lead sources, custom-field
definitions, and per-entity custom-field values have explicit safety caps.
Repositories join activity actor display data in the original query, avoiding
N+1 fetches.

Indexes follow the actual filters and ordering: tenant/status/date for main
lists, assignee/status/due date for tasks, parent/date for activity and detail
lists, definition entity/label for settings, and entity IDs for custom-field
values. Search remains intentionally database-local for this single internal
CRM dataset; Redis, Elasticsearch, queues, and speculative caches are absent.

## Testing

- Vitest unit tests cover shared catalogs affected by CRM.
- Real-Postgres integration tests exercise services and security fixes.
- Restricted-role tests use `APP_DATABASE_URL` and self-skip rather than
  claiming RLS proof when that role is unavailable.
- CRM Playwright tests run against `next build` + `next start`, exercising
  navigation, RBAC, workflows, lifecycle, settings, responsive behavior,
  not-found handling, and unsafe rendering.
- Accessibility tests use one Chromium worker. Because authentication has an
  intentional in-memory attempt limit, the 18-case suite may be split into
  deterministic batches with a production-server restart between batches.

## Known limitations and Sales Pipeline compatibility

- Build 19 does not deploy or start Roadmap Module 14 — Sales Pipeline.
- Lead stages are the fixed CRM lifecycle enum, not a configurable pipeline.
- Conversion marks the lead terminal but does not provision a tenant or run
  onboarding.
- CRM tasks and custom fields deliberately remain module-local as described
  above.
- CRM tags, bulk import/export, deduplication, global search, forecasting,
  automation, and third-party CRM synchronization are not implemented.
- Offset pagination is appropriate for the current internal dataset; cursor
  pagination can replace it later without changing ownership semantics.

Future Sales Pipeline work should reference existing `CrmLead` IDs rather
than duplicate leads, preserve terminal history and immutable activities, and
introduce stages/deals in a new migration and authorization review. It must
not reinterpret CRM companies as Organizations or CRM contacts as Users.
