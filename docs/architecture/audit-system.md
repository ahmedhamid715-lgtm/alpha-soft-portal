# Audit & Compliance System (Module 08)

Written before implementation, per this module's own mandate. Everything
below reflects what was actually inspected in Modules 01–07, and every
design choice states which existing mechanism it reuses and why nothing
new was invented where an existing one already fit.

## Core principle

**Audit logs are evidence, not application logs.** `lib/logging/*`
(Module 01) answers "what happened while the software was running" — it's
verbose, sampled where needed, and its own retention/format concerns are
operational. The audit system answers "what action did an identifiable
actor actually perform" — every record here is a discrete, permanent,
queryable fact about a security- or business-significant action, written
by trusted server code only. The two systems share exactly one utility
(the redaction *pattern*, not the module — see "Redaction" below) and are
otherwise fully independent: different tables, different write paths,
different retention posture, different UI.

## Phase 1 — what already exists (inspected, not assumed)

| Concern | Existing mechanism | Reused as-is? |
|---|---|---|
| Request correlation | `lib/platform/request-id.ts` — `getOrCreateRequestId(request: Request)` | **Partially.** It requires a `Request` object, which only Route Handlers have. Almost every Module 07 mutation is a **Server Action**, which never receives one. See "Request IDs in Server Actions" below. |
| Domain events | `lib/platform/events.ts` — in-process, non-durable `EventBus`, fire-and-forget via `Promise.allSettled`, called *after* a transaction commits (see every Module 07 service) | **Not** used as the audit write path — see "Why not the EventBus" below. |
| Structured logging | `lib/logging/*` — `logger.info/error(msg, context)`, deep-redacts via `redact.ts` before serializing | Pattern reused (own redaction module, audit-specific keys), storage independent |
| Transactions | `lib/db/transaction.ts` (`withTransaction`), `lib/tenancy/context.ts` (`withTenantContext`) — both now correctly re-throw `AppError`s (fixed in Module 07) instead of masking them as `DatabaseError` | Directly reused — audit writes for security-sensitive mutations run **inside** the same `withTenantContext()` call as the business mutation |
| Authorization | `lib/authorization/{permissions,roles,authorize}.ts` — `requirePermission(key, organizationId?)`, PLATFORM vs ORGANIZATION scope | Directly reused — new `audit.read`/`audit.export`/`audit.readPlatform`/`audit.exportPlatform` permissions added to the same catalog, no parallel engine |
| Tenant context / RLS | `lib/tenancy/context.ts`, `client.ts` (`tenantDb`, the restricted `alpha_os_app` role), migration `20260817090000_row_level_security` | Directly reused — `AuditEvent` gets its own RLS policies following the exact same shape as `organization_invitations` (Module 07) |
| Identity | `lib/auth/session-guard.ts` — `getCurrentUser()`, `CurrentIdentity { user, sessionId }` | Directly reused — the audit service never accepts a caller-supplied actor; it resolves `getCurrentUser()` itself |
| Pagination | `lib/platform/pagination.ts` — `CursorPaginationParams`/`CursorPaginatedResult`, `MAX_PAGE_SIZE = 100` | Directly reused for the audit query service — cursor, not offset (see "Query & export" below) |
| UI | Module 02 `StatusBadge`, `PageHeader`/`SectionHeader`, `EmptyState`, `Card`, `Button`, `Pagination` primitives | Directly reused — no new primitives. The audit log is server-paginated (a cursor, not a client-side row-count), so `DataTable`'s client-owned pagination doesn't fit here — a plain server-rendered table + `Pagination`'s Link-based Previous/Next does |
| Existing security-sensitive mutations | Enumerated below | Every one gets an audit call site |

### Every currently-existing security/business-sensitive mutation

Authentication (Module 04, `auth-service.ts`/`src/auth.ts`): login
success, login failure, logout, password reset, session revocation.
Authorization (Module 05, `role-service.ts`): role assignment, custom
role create/update/delete, permission-denied (any `requirePermission()`
throw). Organizations (Module 07,
`organization-management-service.ts`): create, profile update, suspend,
reactivate, archive. Membership (Module 07, `role-service.ts`,
`membership-service.ts`): role change, suspend, reactivate, remove.
Invitations (Module 07, `invitation-service.ts`): create, accept, revoke,
resend. Ownership (Module 07, `ownership-transfer-service.ts`): transfer.
Profile (Module 07, `user-profile-service.ts`): self-service update — a
low-sensitivity, non-security field set (name/avatar/timezone/locale;
never email/password/role), audited at `SUCCESS`-only, best-effort (see
"Failure semantics").

### Request IDs in Server Actions

`getOrCreateRequestId()` cannot be reused directly — Server Actions have
no `Request` object. Per this module's own definition ("`requestId` = one
HTTP request / Server Action execution"), the audit service **mints a
fresh UUID per top-level audited call** when none is supplied, using the
same `randomUUID()` primitive `request-id.ts` already uses. This is not a
new concept, just the same one applied at the correct boundary. A future
Route Handler that calls into an audited service can pass its own
`requestId` through explicitly — the parameter exists for exactly that.

### Why not the EventBus

`events.ts`'s own comment states it plainly: "synchronous and
non-durable," and every existing caller (`organization-management-service.ts`,
`invitation-service.ts`, `ownership-transfer-service.ts`) calls
`events.emit(...)` **after** `withTenantContext()`'s transaction has
already committed — logging, not transactional. Phase 13 of this module
requires business-mutation-plus-audit-event to share a transaction for
security-sensitive events. An EventBus subscriber, by construction, runs
outside that transaction. So the audit service is a **direct function
call**, invoked from inside the same `withTenantContext()`/`withTransaction()`
callback as the mutation it's recording — not a listener on the existing
bus. The existing `events.emit()` calls are untouched; they remain
Module 01's own notification/integration hook (documented for Module 09
in `invitations.md`), a genuinely separate concern from evidence-grade
audit recording.

### Naming inconsistency, inherited and closed here

Module 05's own domain events use PascalCase (`RoleCreated`,
`MembershipRoleAssigned`); Module 07's use dot-notation
(`organization.created`). This module's spec, and Module 07's spec before
it, both explicitly ask for dot-notation. **The audit event catalog
(Phase 3) is the first canonical, enforced naming authority** — it does
not rename any existing `events.emit()` call, but every future module's
*audit* calls must draw from `lib/audit/catalog.ts`, regardless of
whatever string convention that module's own domain events use.

## Trust boundaries

```
Client (browser)
  │  — never sends actorId, organizationId as trusted, never sends
  │    resourceId/previousState/newState directly into audit storage
  ▼
Server Action / Route Handler
  │  — calls requirePermission() for the business mutation (unchanged)
  │  — calls audit.recordX(...) — NO caller-supplied actor accepted
  ▼
audit service (lib/audit/service.ts)
  │  — resolves actor from getCurrentUser() itself
  │  — resolves organizationId from the AuthorizationContext the
  │    business mutation already established (never a raw param)
  │  — redacts metadata/state before it ever reaches a query builder
  ▼
withTenantContext() / withTransaction()
  │  — same transaction as the business mutation, for the events this
  │    doc marks mandatory-atomic
  ▼
PostgreSQL — alpha_os_app (restricted role, RLS FORCEd, UPDATE/DELETE
  revoked on audit_events specifically)
```

The one place trust is *established* (not just checked) is
`getCurrentUser()` — everything downstream treats its result as fact,
exactly as every other module in this codebase already does.

## Data model (Phase 2)

Every field below has a stated reason; none were added "because it
sounds enterprise."

| Field | Reason |
|---|---|
| `id` | UUIDv7, this project's existing ID convention (`generateId()`) |
| `organizationId` (nullable) | Nullable because pre-tenant events are real: a login failure before any org is known, a platform-wide administrative action, an unauthenticated denied request. Never nullable for an organization-owned mutation. |
| `actorType` | Distinguishes a human from automation from (future) AI — required for the audit UI's "who" answer and for Phase 28's AI-actor requirement to be meaningful rather than bolted on later. |
| `actorUserId` (nullable) | Null for `SYSTEM`/unauthenticated events (e.g. a failed login for an email with no matching user). |
| `actorDisplayName` (snapshot) | A user's `name`/`email` can change or the row can eventually be deactivated; the audit record must still read correctly years later without a join that could return stale or missing data. Snapshotting a *display* value (not a foreign key) is exactly the same reasoning Module 07 applied to `Invitation` never joining live to compute its own display state. |
| `action` | The canonical catalog key (`organization.suspended`) — see Phase 3. |
| `category` | Coarser grouping for filtering/UI grouping than 40+ individual actions. |
| `outcome` | `SUCCESS`/`FAILURE`/`DENIED` — distinct concepts: a login can fail (wrong password) without ever reaching an authorization decision; a permission check can explicitly deny. Collapsing these would make "why did this happen" unanswerable from the outcome alone. |
| `resourceType`/`resourceId` (nullable) | What the action was about — nullable for actions with no single resource (e.g. `auth.login.failure` before any user is resolved). |
| `resourceName` (snapshot, nullable) | Same reasoning as `actorDisplayName` — an organization's `displayName` at the moment of the event, not a live join. |
| `previousState`/`newState` (JSON, nullable) | Field-level diffs only — see Phase 11, never a full row snapshot. |
| `metadata` (JSON, nullable) | Small, bounded, action-specific extra context (e.g. an invitation's offered role name) — always redacted before write. |
| `ipAddress` (nullable) | Best-effort investigative signal — see "IP/UA handling." Never used for an authorization decision. |
| `userAgent` (nullable, truncated) | Same category as `ipAddress`. |
| `requestId` | Correlates every log line and audit record from one execution. |
| `correlationId` | Groups multiple audit events from one logical operation (Phase 25) — defaults to `requestId` when an operation only ever produces one event. |
| `createdAt` | Append-only timestamp — server-generated (`now()` at the database, not client-supplied `Date.now()`), so client clock skew can never misorder the record. |

Deliberately **not** included: a mutable `updatedAt` (the table is
append-only — see Phase 8), a `deletedAt` (no soft-delete for audit
rows — see "Retention"), raw request bodies or headers, cookies (Phase
23/24 explicitly forbid these).

## Event taxonomy (Phase 2/3)

`actorType`: `USER | SYSTEM | SERVICE | AI | API | AUTOMATION`.
`outcome`: `SUCCESS | FAILURE | DENIED`.
`category`: `AUTHENTICATION | AUTHORIZATION | ORGANIZATION | MEMBERSHIP |
INVITATION | ROLE | SECURITY | DATA | SYSTEM | ADMINISTRATION | COMPLIANCE`.

All three are Prisma enums (extensible only by migration — deliberately;
an audit taxonomy that any code path can silently extend at runtime is
not a taxonomy). `action` itself is a plain, indexed `String` — see
Phase 3's own reasoning for why a fixed-enum action list would be the
wrong choice for an extensible catalog.

## Authorization model (Phase 7)

Four permissions, all under Module 05's existing catalog, no parallel
engine:

- **`audit.read`** (ORGANIZATION scope) — view this organization's own
  audit trail. Granted to `owner`/`admin`.
- **`audit.export`** (ORGANIZATION scope) — export this organization's
  own audit trail. Granted to `owner` only — a narrower grant than
  `audit.read`, the same "export is higher-risk than view" reasoning
  spec section 47/`ownership.transfer` already established for
  higher-risk actions in this codebase.
- **`audit.readPlatform`** (PLATFORM scope, `keyOverride` — same resource
  `"audit"`, disambiguated key, matching `ownership.transfer`'s own
  precedent) — view platform-wide audit events, including events with no
  organization context. Granted to `platform_owner`/`platform_admin`
  only — **not** `support_admin`/`support_agent`, a deliberate,
  documented restriction (see "Platform vs. organization audit" below).
- **`audit.exportPlatform`** (PLATFORM scope) — same grant as above.

### Platform vs. organization audit

Two structurally separate query paths, not one query with an
`isPlatformStaff` bypass flag:

- **Organization audit** (`audit.read`, ORGANIZATION scope): resolves via
  `resolveOrganizationContext(organizationId)` exactly like every Module
  07 query — a real, current membership is required. A platform admin
  with no membership in a customer organization gets **zero** rows here,
  the same as any other non-member.
  it just found is scoped to `organizationId = tenant_current_organization_id()`.
- **Platform audit** (`audit.readPlatform`, PLATFORM scope): resolves via
  `resolvePlatformContext()` — a real, ACTIVE membership in the one
  `isPlatform` organization. Query scope: `organizationId IS NULL` (true
  platform-wide events with no tenant owner) **plus** events belonging
  to the platform organization itself. **This does not include other
  organizations' events** — platform staff investigating a specific
  customer incident must be added to that organization (or a future,
  explicitly-scoped support-access policy must be built) rather than
  this module quietly widening `audit.readPlatform` to "see everything."
  This is the direct implementation of the spec's own instruction: "do
  not equate platform admin with unlimited access to all customer audit
  data."

## Tenant isolation (Phase 6)

Two independent layers, neither a substitute for the other — same
posture Module 06 established:

1. **Application**: `requirePermission("audit.read", organizationId)` —
   the same chokepoint every Module 07 query already uses.
2. **Database**: RLS on `audit_events`, `FORCE`d, evaluated by the
   restricted `alpha_os_app` role (never a superuser — see Module 06's
   own methodology, reused verbatim for this module's RLS tests).
   Policy shape (SELECT, as of migration
   `20260818093000_audit_select_policy_null_org` — see "Bugs found"
   below for why it isn't the first-draft shape):
   `organization_id = tenant_current_organization_id()
    OR organization_id IS NULL
    OR tenant_is_platform_context()` — a NULL-organization row (a
   pre-tenant event) is visible under RLS to any authenticated tenant
   context, not just platform staff; this is safe because a NULL-org row
   isn't tenant-owned data in the first place (Org A's context still can
   never see Org B's real rows, the actual property RLS exists to
   guarantee), and the APPLICATION layer's own `organizationId` filters
   (`lib/audit/query.ts`) are what narrow "visible under RLS" down to
   "actually returned to this specific caller." RLS's job here is the
   second-line "even if application code has a bug, Org B can never read
   Org A's rows" guarantee, identical in spirit to every other
   RLS-protected table in this codebase.

## Write strategy & immutability (Phase 8)

- **INSERT-only from the application.** No repository function exposes
  `update`/`delete`. This is enforced at two levels: application
  (`auditEventRepository` has no such export) and database (`REVOKE
  UPDATE, DELETE ON audit_events FROM alpha_os_app`, applied in the
  migration itself when the restricted role already exists, and
  documented as a required step alongside the role's own creation SQL in
  `rls.md` for environments where the role is created afterward).
- **Honest trust model, stated explicitly**: this does **not** protect
  against a database superuser (`ahmed` locally, the Supabase dashboard
  `postgres` role) — nothing in Postgres can, short of infrastructure the
  application doesn't control (write-once storage, an external log
  shipper). The restricted role — the same one RLS depends on for every
  other table — is what makes "no *application* code path can mutate an
  audit row" a real guarantee rather than a documentation claim. See
  `audit-security.md` for the full, unhedged statement of what this does
  and does not defend against.

## Tamper evidence (Phase 9) — not implemented, decision documented

**Hash-chaining was evaluated and deliberately not built for Module 08.**
Reasoning:

- A correct hash chain requires a **single, serialized writer** (or
  row-level locking equivalent to Module 07's `SELECT ... FOR UPDATE`
  ownership-transfer pattern) to guarantee "previous digest" is
  unambiguous under concurrent writes. Audit events are written from many
  concurrent requests across every organization simultaneously — a
  global chain would serialize *all* audit writes platform-wide behind
  one lock, which this module's own Phase 21 performance concern
  explicitly warns against creating without justification. A per-organization
  chain avoids the global bottleneck but multiplies the operational
  complexity (verification must reconstruct per-tenant chains, genesis
  handling per tenant, etc.) for a guarantee this module can honestly
  deliver in a much simpler way today.
- The actual, honest value hash-chaining would add here is **"detect that
  a row was altered/deleted after the fact, when independently
  verified"** — and per this module's own instruction, it explicitly
  does **not** stop a database administrator (or the `ahmed`/Supabase
  `postgres` superuser role) from deleting rows and rewriting the chain
  around the gap, since that same superuser can also run the verifier
  after having done so.
- Given a real, working "no application code path can UPDATE/DELETE"
  restriction already exists (the restricted-role REVOKE above) and is
  independently testable with the exact methodology Module 06 already
  proved out, adding a hash chain on top would be exactly the
  "meaningless hash field because it sounds enterprise" this module's
  own spec explicitly warns against — unless and until there's a
  concrete follow-up requirement (e.g. an external, independent
  write-once log shipper) that a chain would meaningfully strengthen.

**Documented, not implemented. Revisit if/when**: (a) a genuine
compliance requirement names cryptographic integrity specifically, or
(b) audit rows are shipped to an external, independent store where a
chain's "detect after-the-fact tampering, once verified independently"
property becomes meaningful rather than circular.

## Redaction (Phase 10)

`src/lib/audit/redact.ts` — a **separate module** from
`lib/logging/redact.ts`, not a shared import, for two reasons: audit
redaction must be *stricter* (this data is retained far longer and
reviewed by more people than a log stream), and per this doc's own "Core
principle," these are deliberately independent concerns even where their
underlying algorithm looks similar. The traversal algorithm (deep,
depth-bounded, array-aware, case-insensitive key match) is the same
proven shape as `lib/logging/redact.ts`; the **pattern is broader**,
explicitly covering every key this module's own spec lists
(`password`, `passwordHash`, `token`, `secret`, `apiKey`, `accessToken`,
`refreshToken`, `authorization`, `cookie`, `privateKey`, `clientSecret`)
plus the logging module's existing set (`sessionId`, `creditCard`, `ssn`).
Applied to every `metadata`/`previousState`/`newState` object before it
is ever handed to Prisma — never trusted to be pre-redacted by the
caller. See `audit-security.md` for the exact test matrix (nested
objects, arrays, mixed).

## State-change capture (Phase 11)

`previousState`/`newState` are **field-level diffs the calling service
explicitly builds**, never a full-row snapshot. Convention: only the
fields that changed and are meaningful to a human investigating the
event (e.g. `{ role: "member" }` → `{ role: "admin" }`), passed through
the same redaction pass as `metadata`. A service that has no meaningful
diff (e.g. `organization.created` — there is no "previous state") omits
both fields entirely.

## Transactional consistency & failure semantics (Phase 13/14)

| Mutation | Atomic with audit write? | Reasoning |
|---|---|---|
| Org create/update/suspend/reactivate/archive | **Yes** | Security-sensitive, already inside `withTenantContext()` |
| Member role change/suspend/reactivate/remove | **Yes** | Same |
| Invitation create/accept/revoke/resend | **Yes** | Same — acceptance is also the mandatory race-safe path from Module 07; the audit write for the winning claim happens inside that same transaction |
| Ownership transfer | **Yes** | Highest-sensitivity mutation in the module; already row-locked |
| Login success/failure, logout | **Best-effort, non-blocking** | `createUserSession`/credential verification happen **before** any tenant transaction exists (Module 04's identity resolution is explicitly pre-tenant — see `rls.md`'s own reasoning). Forcing a shared transaction here would mean either bypassing Module 04's session creation flow or wrapping it in a new transaction boundary that module never had — out of this module's "do not rewrite Module 04" mandate. Documented exception, not a silent gap. |
| Permission denied | **Best-effort, non-blocking** | A denial, by definition, means no mutation transaction was ever opened to share. |
| Password reset (session revocation) | **Best-effort, non-blocking** | Same pre-tenant reasoning as login/logout — `resetPassword()` is a token-authenticated flow with no session and no tenant transaction to share; the actor is the token's `userId` (a `knownActor` override — see `service.ts`), never `getCurrentUser()`. |
| Self-service profile update | **Best-effort, non-blocking** | Explicitly low-sensitivity (Phase 12: "do not create noisy audit events... audit meaningful actions"); still audited, just not fail-closed. |

**Failure behavior**: for every "Yes" row above, an audit-write failure
**throws** — the whole transaction (business mutation included) rolls
back. This is a deliberate fail-closed choice: "role changed successfully
but the audit record silently failed" is exactly the scenario Phase 13
forbids. For "best-effort" rows, an audit-write failure is caught,
logged via `logger.error()` (application logging, not swallowed
silently — the failure itself is observable), and does **not** block the
underlying operation (a login must not fail because the audit table is
briefly unavailable). No call site anywhere uses a bare
`try { await audit.record(...) } catch {}` — every catch block logs.

## Correlation (Phase 25)

`requestId`: minted fresh per top-level Server Action/service call (see
"Request IDs in Server Actions"). `correlationId`: defaults to the same
value as `requestId` for single-event operations; explicitly threaded
when one logical operation is expected to produce multiple audit events
in the future (the parameter exists now so no future module needs a
migration to add it).

## Query & export (Phase 15/19)

Query service (`lib/audit/query.ts`) reuses `lib/platform/pagination.ts`
verbatim — but `CursorPaginationParams`/`CursorPaginatedResult`, not
`OffsetPaginationParams`. Offset (`page`/`limit`) was the first draft;
`pagination.ts`'s own top comment names "an audit log or an activity
feed" as the paradigm case for cursor pagination specifically — an
append-only, high-insert-rate table is exactly where `OFFSET n` skips or
duplicates rows as new events land between two page loads. Switched
before shipping, not after finding the bug in production. The cursor is
a row's own `id` (a UUIDv7 — time-ordered by construction, see
`lib/utils/id.ts`), so `ORDER BY id DESC` doubles as both the sort and
the cursor key, no composite `(createdAt, id)` cursor needed. Capped at
`MAX_PAGE_SIZE` (100). Filters: organization (implicit from the resolved
context, never a raw client param used directly), actor, action,
category, outcome, resource type/id, date range, requestId,
correlationId, free-text (matches `action`/`resourceName`/`actorDisplayName`).
No filter bypasses the same permission check the base query uses.
Trade-off: cursor pagination gives an honest "Next," never a "jump to
page 7" or a total page count — the audit UI reflects this (forward-only
navigation; the browser's own back button returns to a previous page's
URL, which re-fetches it directly).

Export: CSV, same query path and same filters as the list view (no
separate, less-audited code path), hard-capped row count, itself
recorded as `audit.export.created` (Phase 19's own requirement — the
export mechanism does not exempt itself from being audited).

## Retention (Phase 20) — documented, not automated

No deletion job ships in Module 08. Default posture: audit rows are
retained indefinitely until a real compliance/retention module exists to
own the policy correctly (legal hold, per-tenant retention overrides,
verified archival before delete). Automating deletion now, without that
machinery, is exactly the "dangerous cron job" this module's own spec
warns against. See `audit-retention.md` for the full policy write-up and
the future mechanism this module deliberately leaves unbuilt.

## Privacy (Phase 23) & IP/UA handling (Phase 24)

No raw request bodies, no arbitrary headers, no cookies are ever stored
— `metadata` is a small, explicit, per-call object the service author
writes by hand, never a serialized `req`. `ipAddress`/`userAgent` are
captured via Next.js's `headers()` (available inside Server Actions,
unlike a raw `Request`) **best-effort, with no established trusted-proxy
model in this codebase yet** (confirmed by inspection — no
`x-forwarded-for` handling exists anywhere before this module). Both
fields are documented as investigative metadata only, never used in an
authorization decision, and `X-Forwarded-For`'s first value is taken
as-is with no verification — exactly the caution this module's own spec
requires being explicit about, not silently assuming a reverse proxy
sanitizes it.

## Performance & partitioning (Phase 21/22)

Indexes: `(organizationId, createdAt)`, `(actorUserId, createdAt)`,
`(resourceType, resourceId)`, `(action, createdAt)`, `requestId`,
`correlationId`, `(category, createdAt)` — one per the query service's
own actual filter combinations, not a blind "index everything." No
partitioning in Module 08: the current data volume (a handful of
mutations per organization per day) does not remotely approach the scale
where Postgres native partitioning earns its operational complexity.
Documented threshold to revisit: sustained multi-million-row single-table
scans with measurably degrading `EXPLAIN` plans — not a number picked in
the abstract, a real symptom to watch for.

## Bugs found by actually running the suite, not just inspection (Phase 40/41)

**`AuditEvent.organizationId`/`actorUserId` FK was originally `Restrict`,
not `SetNull`.** The first draft followed `tenancy-foundation.md`'s
"Restrict, never Cascade" literally, reasoning that organizations/users
are never hard-deleted in this app so the choice was moot either way.
Running the full integration suite (not just source inspection)
immediately falsified that: every existing Module 07 test's `afterEach`
hard-deletes its fixture organizations/users, and the moment any audited
mutation ran during a test, cleanup started failing with
`Foreign key constraint violated on the constraint:
audit_events_organization_id_fkey`/`..._actor_user_id_fkey` — 53 tests
across `ownership-transfer-service.test.ts` and
`role-service.test.ts` failed this way. `Restrict` doesn't just protect
against accidental deletion — it makes deletion of an org/user
*permanently impossible* the instant a single audit event references it,
for tests and for any real future hard-delete need alike.
Migration `20260818091500_audit_fk_setnull` fixed this: both FKs are now
`SetNull` (an equally valid choice under tenancy-foundation.md's own
"Restrict or SetNull, never Cascade" rule) — a hard-deleted
organization/user leaves `organizationId`/`actorUserId` null on its old
audit rows, but the row itself, and its `resourceName`/`actorDisplayName`
snapshot fields, survive intact. No evidence is lost; the FK's job is
referential integrity, not being the only copy of the identifying
information.

**The SELECT policy on `audit_events` was missing the same
`organization_id IS NULL` allowance the INSERT policy already had.**
The first-draft SELECT policy was `organization_id =
tenant_current_organization_id() OR tenant_is_platform_context()` — no
NULL-organization clause. This looked fine in isolation (and passed
`prisma validate`/manual SQL review) but broke the moment a real,
non-platform, non-superuser context tried to write a pre-tenant audit
event: Prisma's `create()` always issues `INSERT ... RETURNING *`, and
under `FORCE ROW LEVEL SECURITY` a `RETURNING` clause must *also*
satisfy the SELECT policy for the row it just inserted — not just the
INSERT policy's own `WITH CHECK`. A `withTenantContext({ organizationId:
null, ... })` caller inserting a NULL-org row got `new row violates
row-level security policy for table "audit_events"` even though the
INSERT policy's own `OR organization_id IS NULL` clause explicitly
allowed the write. Found by running a real `tx.auditEvent.create()`
against real Postgres with the restricted role (Phase 40/41) — not by
re-reading the SQL, which "looked" correct. Masked in the live
application today because every current NULL-organization call site
(login success/failure) is a best-effort write through the plain,
superuser `db` client, which bypasses RLS entirely and never exercises
this path — a real gap nonetheless, and one a future module combining
`tx` (a tenant-scoped transaction) with a NULL-organization event would
have hit immediately. Migration `20260818093000_audit_select_policy_null_org`
fixed it — see `tests/integration/db/audit-rls.test.ts`'s regression
test for the specific case ("a NULL-organization audit row... can be
inserted under NO tenant context at all").

**The query service's reads never actually went through RLS at all.**
`lib/audit/query.ts`'s functions called `auditEventRepository.list()`/
`listForExport()`/`findById()` with no `tx` argument, which defaults to
the plain, superuser `db` client (bypasses RLS entirely — that client
exists specifically for migrations/health checks/pre-tenant lookups, see
`lib/tenancy/client.ts`). `requirePermission()` was still a real,
independently-enforced gate — every access-control test in this module
(viewer denied, customer denied, cross-org denied) passed regardless —
but the DB-layer half of "two independent layers, neither a substitute
for the other" (this file's own "Tenant isolation" section, and
`audit-rls.test.ts`'s entire premise) was never actually exercised by
the real application: RLS existed, was correctly configured, and was
completely unreachable from every real query the UI/export routes
issued. Found while writing this module's own accessibility E2E tests
and re-examining the read path end-to-end, not by a failing test (there
was no test that could have caught this — the gap was between two
things that were each independently well-tested: `requirePermission()`
and RLS's own policies, never exercised *together* through the actual
call chain). Fixed by wrapping every read (`listOrganizationAuditEvents`,
`listPlatformAuditEvents`, `getAuditEventDetail`'s detail re-check,
both export paths) in `withTenantContext()`, using the `AuthorizationContext`
`requirePermission()` already resolved — the same `tenantInputFor()`
pattern `role-service.ts`/`membership-service.ts` use for writes, now
applied to reads too. `getAuditEventDetail()`'s *initial* `findById()`
remains on the plain `db` client deliberately — until that lookup
resolves, this event's `organizationId` (and therefore which tenant
context could even see it under RLS) is unknown; the same "discovery
lookup, not a grant — `requirePermission()` is the real gate" reasoning
`role-service.ts`'s `assignRole()` already documents for its own
initial membership lookup.

**`getAuditEventDetail()` crashed with an unhandled 500, not a clean
404, for a cross-organization detail-page guess.** A caller who
genuinely holds `audit.read` for their OWN organization, but constructs
a detail-page URL using a real event id belonging to a DIFFERENT
organization, hit this function's `requirePermission("audit.read",
<that other org>)` call — which correctly threw `PermissionDeniedError`
(the caller really doesn't have that permission) — but nothing caught
it. The org-scoped detail page only guards its own top-level "does this
caller hold `audit.read` for the URL's org" check; it never wrapped this
function's *internal* one. The same crash hit a platform admin
(`audit.readPlatform` only) guessing a real customer-org event's id
directly under `/admin/audit/`. No data was ever disclosed either way —
the 500 page renders nothing — but the *failure mode* was wrong: this
codebase's own established convention (`password-reset-service.ts`,
invitation acceptance) is that an IDOR attempt looks identical to "not
found," never a crash. Found via real adversarial E2E tests
(`audit-security.spec.ts`) constructing exactly these URL shapes, not by
inspection. Fixed two ways: (1) the function now accepts its
`organizationId` parameter as a real expectation — a mismatch returns
`null` before ever calling `requirePermission()` against the other
organization at all; (2) `PermissionDeniedError` from either
`requirePermission()` call is now caught and converted to `null` (an
`AuthenticationError` — no session at all, a genuinely different problem
— still propagates normally). See
`tests/integration/db/audit-service.test.ts`'s regression test.

## Future-module contract (Phase 36)

**No future business module may create its own audit table.** Every
mutation worth auditing calls `audit.recordSuccess()`/`recordFailure()`/
`recordDenied()` from `lib/audit/service.ts`, which automatically
supplies actor/organization/requestId/correlationId/redaction — see
`docs/development/auditing.md` for the exact, current API and a worked
example.
