# Row-Level Security (Module 06)

The database-level second line of defense beneath Module 05's application
authorization. See `multi-tenancy.md` for the tenant ownership
classification and application-level isolation this sits underneath, and
`authorization.md`/`rbac.md` for the RBAC layer this never replaces.

## What RLS does and does not defend against

This is the single most important thing to understand before reading any
policy SQL below — get it wrong and either the tests look meaningless or
the design looks broken when it isn't.

**RLS defends against**: a bug in application code that has *correctly*
established tenant context and then does something wrong with it — a
repository function that forgot its own `organizationId` `WHERE` clause,
a raw query run from a future internal tool or one-off script, a
background job (Module 06's job contract, see below) that connects
directly. In every one of these cases, Postgres itself — not the missing
application code — is what limits the result to the caller's own
organization. This module's own test suite proves this directly
(`tests/integration/db/rls.test.ts`, "with a CORRECT... context, a query
with NO organizationId filter at all still only returns that org's
rows").

**RLS does not defend against**: the tenant-context-*setting* call itself
being fed a forged value. `withTenantContext()`
(`src/lib/tenancy/context.ts`) trusts its input completely — it is not
an authorization decision, it's the mechanism that enforces one already
made. If an attacker could somehow make `withTenantContext()` itself
call with `organizationId: "someone-elses-org"`, RLS would faithfully
protect *that* (wrong) tenant boundary — because that IS what RLS was
told is authoritative. This is not a limitation specific to this
implementation; it's true of any RLS design built on transaction-local
session settings. What stops that scenario is Module 05's authorization
engine (`requirePermission()`) independently re-verifying, via a real
database read, that the caller genuinely has the context being
established — RLS is the *second* line of defense for what happens
after that check passes, never a replacement for the check itself.

Confirmed both halves of this with a real, live test during this
module's own build: setting `app.organization_id` to an organization the
caller does *not* belong to (simulating a compromised context-setter, a
scenario outside RLS's threat model) correctly let the query see rows in
that organization — RLS enforces whatever context it's told, faithfully.
Setting the *correct*, verified organization context and running a query
with zero `WHERE` filter at all still returned only that organization's
rows — RLS enforcing the real boundary regardless of the query's own
carefulness. Both are RLS working exactly as designed; the first is not
a vulnerability, it's a reminder of where the real trust boundary is.

## The restricted role

**The single most important prerequisite for any of this to matter at
all.** Postgres tables' *owner* bypasses RLS unconditionally unless
`FORCE ROW LEVEL SECURITY` is also set — and even `FORCE` does nothing
against a role with the `BYPASSRLS` attribute, which **every Postgres
superuser has, unconditionally, with no override.** This project's local
Postgres role (`ahmed`, used for migrations) is a superuser. Supabase's
default connection (the `postgres` user from the dashboard's connection
string) is effectively the same. Connecting the app's own runtime
queries through either of those makes every policy in this file pure
theater — confirmed directly: `SELECT rolsuper, rolbypassrls FROM
pg_roles WHERE rolname = 'ahmed'` returns `t, t`.

The fix is a **separate, restricted, non-superuser Postgres role** that
owns nothing and has no elevated attributes — RLS applies to it
unconditionally. `APP_DATABASE_URL` (`.env.example`, `serverEnv`) is its
connection string; `src/lib/tenancy/client.ts`'s `tenantDb` is the
Prisma Client that uses it. `src/lib/db/client.ts`'s original `db`
singleton is **unchanged** — Modules 01–05's existing code keeps using
it exactly as before, for exactly the reasons `tenancy/client.ts`'s own
comment explains (migrations, health checks, and Module 04's own
session/credential lookups predate RLS and must keep working unmodified).

Create the role once per environment (local, staging, Supabase) — never
committed, never in a migration file, since it's credential-bearing:

```sql
CREATE ROLE alpha_os_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION
  PASSWORD '<generate one — openssl rand -hex 24, URL-safe, no special characters that would break a connection-string URL>';

GRANT USAGE ON SCHEMA public TO alpha_os_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alpha_os_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alpha_os_app;

-- Module 08 — audit_events is INSERT + SELECT only, even for this
-- otherwise-broad role. Migration 20260818090000_audit_system already
-- runs this REVOKE for any environment where alpha_os_app already
-- exists at migration time; run it again here for a role created
-- *after* that migration already applied (a fresh environment set up in
-- the order this file recommends — role first, then `prisma migrate
-- deploy` — never hits this gap, but re-running it is harmless either
-- way). See docs/architecture/audit-security.md for the full trust
-- model this restriction is (and is not) part of.
REVOKE UPDATE, DELETE ON audit_events FROM alpha_os_app;

-- Module 09 — notifications/notification_deliveries are never deleted
-- by the application (UPDATE stays granted — marking a notification
-- read/archived, and the delivery processor updating attempt state, are
-- real operations). Same "re-run for a role created after the migration
-- already applied" reasoning as above. See
-- docs/architecture/notification-security.md.
REVOKE DELETE ON notifications FROM alpha_os_app;
REVOKE DELETE ON notification_deliveries FROM alpha_os_app;

-- Module 13 — `ALTER DEFAULT PRIVILEGES ... ON TABLES` above only
-- covers future TABLES, not sequences (a different Postgres object
-- class with its own privilege model — `nextval()` requires explicit
-- USAGE). `invoice_number_seq` (migration
-- 20260821163000_invoice_number_sequence) is the first sequence this
-- codebase creates, so this is the first time that gap has mattered.
-- Deliberately NOT granted inside the migration itself — a migration
-- referencing `alpha_os_app` by name would fail in a fresh environment
-- that runs `prisma migrate deploy` before this role exists, breaking
-- the documented bootstrap order for every environment, not just ones
-- using billing (spec §53: "document the operational step separately").
-- Run this once per environment, same as every grant above; `prisma
-- migrate reset` also wipes this one and it must be re-run alongside
-- the rest of this block.
GRANT USAGE, SELECT ON SEQUENCE invoice_number_seq TO alpha_os_app;
```

**`prisma migrate reset` wipes these grants — re-run this block after
every reset.** The role itself (`CREATE ROLE alpha_os_app`) is
cluster-level and survives a reset; the `GRANT`/`ALTER DEFAULT
PRIVILEGES` statements above are schema-level and do not — `migrate
reset` drops and recreates the schema, taking them with it. Skipping
this step surfaces as every RLS-protected query failing with `permission
denied for schema public`, not a subtler RLS-policy mismatch — found by
actually resetting a local dev database (Module 08's own testing), not
by inspection.

Then set `APP_DATABASE_URL="postgresql://alpha_os_app:<password>@<host>:5432/<database>"`.
`isTenantRoleConfigured` (`lib/tenancy/client.ts`) is `false` if unset —
the app still runs (falling back to `DATABASE_URL`'s role for tenant
queries, logging a warning), but RLS provides no real protection in that
state. Every database-level RLS test in this project's suite
(`tests/integration/db/rls.test.ts`) `skip`s — not fakes a pass — when
this isn't configured, the same "explicit skip" discipline every other
database-integration tier here follows.

**A password containing `/` breaks connection-string URL parsing** —
found while setting this up locally (a `openssl rand -base64` password's
`/` character silently truncated the parsed host/port). Use
`openssl rand -hex 24` (or any alphanumeric-only generator) instead.

## Context functions

Three tiny SQL functions (migration `20260817090000_row_level_security`),
each reading one transaction-local setting:

```sql
CREATE FUNCTION tenant_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;
-- tenant_current_organization_id() and tenant_is_platform_context() follow the same shape.
```

`current_setting(name, true)` — the second argument (`missing_ok`) means
"never set at all" returns SQL `NULL` instead of raising an error.
`NULLIF(..., '')` additionally folds "explicitly set to empty string"
(what `withTenantContext()` writes for a `null` value — Postgres GUCs
are text-typed, they can't hold SQL `NULL` directly) into the same
`NULL`. The result: "no context" and "empty context" behave identically,
and both are `NULL`, which can never equal a real row's `organization_id`
— **the fail-closed guarantee is a property of NULL's own semantics in
SQL, not application logic that could have a bug in it.**

**No `SECURITY DEFINER`** on any of these (spec section 30 — audit every
`SECURITY DEFINER` function; the audit's conclusion here is that none
exist). `SECURITY DEFINER` runs a function with its *creator's*
privileges regardless of caller — appropriate when a function needs to
do something the caller themselves shouldn't be trusted to do directly.
These three functions only read a GUC the calling transaction itself
just set; there is no privilege to elevate, so the Postgres default
(`SECURITY INVOKER`) is correct and strictly safer.

## Transaction-local context, not session-level

`withTenantContext()` (`src/lib/tenancy/context.ts`) opens a Prisma
**interactive transaction** (`tenantDb.$transaction(async (tx) => ...)`)
and, as its first three statements, calls
`SELECT set_config('app.user_id', $1, true)` (and the other two) — the
third argument, `true`, is `is_local`: Postgres's own transaction-scoped
variant of `SET`, equivalent to `SET LOCAL`. This is the load-bearing
detail for connection pooling (below) — a session-level `SET` (`is_local
= false`, or bare `SET`) would persist on the underlying connection past
the transaction, becoming visible to whatever *different* request reuses
that pooled connection next. `is_local = true` guarantees the setting
evaporates the instant the transaction commits or rolls back, regardless
of what happens to the connection afterward.

Verified directly, not just asserted: a raw `psql` session connected as
the restricted role, inside one transaction, sets `app.user_id` and
reads back the caller's own membership row correctly; a **second**,
separate transaction on the same connection with no new context set
sees zero rows. See `docs/architecture/rls.md`'s companion automated
test, and the connection-pooling section below for the harder,
many-alternating-contexts version of the same proof.

### Setting context after opening the transaction

Two of the three settings sometimes need to change *after*
`withTenantContext()` has already opened the transaction:
`setTenantOrganization()` (when a caller opens with `organizationId:
null` — resolving "which of my organizations is this" is itself the
first query inside the transaction — then needs subsequent queries
scoped to whatever that lookup found) and `setTenantPlatformStaff()`
(deliberately never set `true` optimistically before a platform
membership is actually verified — see that function's own doc comment
for why starting optimistic would risk over-broadening visibility for
any future query added to the same transaction, even though today's
one call site happens to be safe either way). Both are just the same
`set_config(..., true)` call, mid-transaction — `is_local` scoping
doesn't care how many times a value is set within one transaction, only
that it resets at the boundary.

## Supabase compatibility & connection pooling

Per `database.md`, Alpha OS's `DATABASE_URL` currently points at
Supabase's **direct connection** (port 5432), not the transaction pooler
(6543/Supavisor) — migrations need direct-connection prepared-statement
support PgBouncer's transaction mode doesn't provide. `APP_DATABASE_URL`
(the restricted role) can safely use **either** — the entire point of
`is_local`/`SET LOCAL` is that it's the documented-safe pattern for
transaction-mode pooling specifically (a pooled connection is handed to
a different logical client on the next transaction; a transaction-local
setting cannot leak across that hand-off, by Postgres's own guarantee,
not by anything this application does). If Alpha OS ever deploys
somewhere serverless enough to need Supavisor for its own runtime
queries, `APP_DATABASE_URL` can point there directly with no code
change — this is precisely the scenario the design was built for.

**Supavisor/PostgREST/Auth are architecturally separate from this app.**
Supabase's own Auth/Storage/Realtime services use their own internal
poolers, not Supavisor, and this app doesn't use Supabase Auth (Module
04 uses Auth.js with its own Credentials provider — see
`authentication.md`) — so none of Supabase's own `anon`/`authenticated`/
`service_role` conventions apply here. `alpha_os_app` is this
application's own role, unrelated to those.

### The mandatory pooling test

`tests/integration/db/rls.test.ts`'s "alternating tenant contexts...
never leak" test: 12 sequential `withTenantContext()` calls, cycling
User A/Org A context, User B/Org B context, and no-context, each
querying the same two known rows (one per org) with **no `WHERE`
filter**. Every single iteration must see exactly the rows its own
context allows — any leakage (Org B's row appearing under Org A's
context, or vice versa, or under no context at all) would fail the
assertion immediately. This is the closest a local, non-pooled Postgres
setup can get to proving the connection-pooling safety claim without an
actual PgBouncer/Supavisor in front of it — the guarantee itself comes
from `SET LOCAL`'s own documented Postgres semantics (verified in
isolation via the transaction-boundary test above), not from this test
alone, but this is what would catch a regression if that guarantee were
ever accidentally broken (e.g., someone changes `is_local` to `false`).

## Protected tables

| Table | Policy shape | Why |
|---|---|---|
| `organization_memberships` | `user_id = tenant_current_user_id() OR organization_id = tenant_current_organization_id() OR tenant_is_platform_context()` (SELECT); organization/platform match only (INSERT/UPDATE/DELETE) | The `user_id` clause is what makes "which orgs do I belong to" resolvable non-circularly — before any specific `organization_id` context exists, a caller can still always see their *own* membership rows |
| `roles` | `organization_id IS NULL OR organization_id = tenant_current_organization_id() OR tenant_is_platform_context()` (SELECT); organization/platform match only (mutations) | System roles (`organization_id IS NULL`) are global reference data, visible to everyone — same as `permissions`, which has no RLS at all (see below) |
| `role_permissions` | `EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND (...same shape as roles...))` | No own `organization_id` column (a pure join — see `rbac.md`); inherits `roles`' own policy via a subquery, which is itself subject to `roles`' RLS, so the rule is defined once |

## Tables deliberately without RLS

- **`Permission`** — the global catalog. Same category as `roles` with
  `organization_id IS NULL`: reference data, not tenant-owned.
- **`User`, `UserCredential`, `UserSession`, `AuthToken`** — Module 04's
  identity/session infrastructure. **Not organization-owned data at
  all** — a `User` can belong to multiple organizations simultaneously
  (that's the entire reason `OrganizationMembership` exists — see
  `tenancy-foundation.md`), so there is no single `organizationId` to
  scope a `User` row to. More importantly: `getCurrentUser()`'s own
  session/credential lookups (Module 04) run *before* any tenant context
  can possibly exist — resolving "who is this session's user" is a
  prerequisite for resolving "which organization," not something that
  can itself depend on tenant context without becoming circular.
  Retrofitting RLS here would require rewriting Module 04's
  authentication path, explicitly out of this module's scope
  ("Preserve Modules 01–05").
- **`Organization`** — the tenant root itself, deliberately **not**
  RLS-protected in this module, despite being a natural-seeming
  candidate. A correct policy needs a non-circular shape (`id IN (SELECT
  organization_id FROM organization_memberships WHERE user_id =
  tenant_current_user_id()) OR tenant_is_platform_context()`, not a
  simple `organization_id` match, since an `Organization` row has no
  `organization_id` column pointing at itself) — and several existing
  Module 04/05 call sites
  (`organizationRepository.findPlatformOrganization()`,
  `findBySlug()`) query it *before* any tenant context is established,
  the same chicken-and-egg shape `organization_memberships`' `user_id`
  clause solves for that table. Enabling RLS here without auditing every
  such call site risks silently breaking one of them. Documented here as
  a genuine, deliberate scope boundary — not implemented, not hidden.
  Recommended next step if a future module needs it: audit every
  `organizationRepository` call site for whether it runs with tenant
  context established, add the `user_id`-based membership-existence
  policy above, `FORCE` it, and re-run this module's own test
  methodology (fail-closed, cross-tenant, connection-pooling) against it
  specifically before trusting it.

## Migration safety (spec section 31)

Both RLS-enabling migrations in this module were additive-only against
tables with either zero rows (`role_permissions` cascades from `roles`,
itself freshly created in the same migration set) or rows whose
`organization_id` was already fully populated and NOT NULL
(`organization_memberships` — Module 03 established `organizationId
NOT NULL` from the start; there was never a nullable-organization-id
migration window to reason about). No backfill, no ambiguous-ownership
rows, nothing to "STOP and report" per spec section 31's own escape
hatch — confirmed by inspection before writing the policies, not
assumed.

## Performance (spec section 46)

Every RLS policy's comparison (`organization_id = ...`, `user_id = ...`)
uses a column already indexed for its own query patterns before this
module (`organization_memberships_role_id_idx`, the existing
`(organization_id, status)`/`(organization_id, user_id)`/`user_id`
indexes from Module 03 — see `rbac.md`'s indexing table). RLS policies
compile into an implicit `WHERE` clause the planner combines with the
query's own filters, not a separate pass over the data.

**Checked with `EXPLAIN` against the real local dataset (17 rows), not
assumed.** At this row count, Postgres's own cost-based planner chooses
a **sequential scan** for `organization_id = ... AND status = 'ACTIVE'`
— genuinely correct, expected behavior: a sequential scan over 17 rows
is cheaper than the overhead of an index lookup, and the planner is
right to prefer it. This is *not* an RLS performance problem; it's how
every small Postgres table behaves regardless of RLS. Forcing the
planner to consider the index anyway (`SET LOCAL enable_seqscan = off`)
confirms the composition actually works when the planner *would* choose
it at realistic production row counts: `organization_memberships_
organization_id_user_id_key` is correctly selected as an `Index Cond`,
with the RLS policy's own `user_id = ... OR organization_id = ... OR
is_platform` clause layered on as an additional `Filter` — RLS does not
block or bypass the index, it composes with it. No RLS-specific index
was needed beyond what already existed for this module's own protected
tables; none was added. Re-run this `EXPLAIN` once real production data
volume exists, rather than trusting extrapolation from 17 rows — that
is the one honest limitation of this check.
