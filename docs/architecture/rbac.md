# RBAC — Roles, Permissions, and the Data Model (Module 05)

The relational model behind Module 05's authorization system. See
`authorization.md` for the runtime engine (context resolution, the
`can`/`requirePermission`/`authorize` API, policies) this data model
feeds.

## The chain

```
User → OrganizationMembership → Role → RolePermission → Permission
```

Not `User.role` (spec section 4) — a role is contextual to a specific
`OrganizationMembership`, because one person can belong to multiple
organizations with a different role in each (Module 03's own reason for
`OrganizationMembership` existing at all — see `tenancy-foundation.md`).
Not a permissions array duplicated onto `User` or `OrganizationMembership`
either (spec section 29) — permissions live once, on `Permission`, joined
through `RolePermission`, so changing what a role grants is a write to
one table, visible everywhere that role is assigned, not N places.

## `OrganizationMembership.role` vs. `.roleId` — two fields, one meaning, kept in sync

Module 04 already had `OrganizationMembership.role`, a plain string
(`"owner"`, `"admin"`, `"support"`, `"member"`), used for post-login
destination routing (`resolveDestination()`). Module 05 adds `roleId`, a
real foreign key to the new `Role` table — the actual authorization
source of truth. Both exist because Module 04 must not be rewritten (the
spec's own explicit boundary): `role` (the string) stays exactly as
Module 04 built it, still read by `destination.ts`, unaffected by
anything Module 05 does. `roleId` is written by
`role-service.ts`'s `assignRole()` — the ONLY function that ever touches
either field, always both together
(`membershipRepository.updateRoleAssignment()`), so they can never drift.

`roleId` is nullable (not a same-migration `NOT NULL`) per
`migrations.md`'s expand→migrate→contract pattern. Module 04's three
original seeded accounts (`owner@alpha-os.test`, `support@alpha-os.test`,
`customer@alpha-os.test` — see `prisma/seed.ts`) are deliberately **not**
backfilled: they predate Module 05's role system, still work exactly as
Module 04 tested them (authentication + destination routing), and simply
resolve zero permissions if any Module-05-aware code ever checked them
(which nothing in Module 04's own shipped scope does). Module 05 ships
its own, richer fixture set instead — see "Seeding" below.

## System roles vs. custom roles

`Role.organizationId` is the discriminator:

- **`null`** — a system role. Global, seeded once
  (`prisma/seed-rbac.ts`) from `src/lib/authorization/roles.ts`'s
  `SYSTEM_ROLES` catalog, `isSystem = true`. Protected: `role-service.ts`
  refuses to update or delete a system role at runtime, unconditionally
  — the only way to change what a system role grants is editing the
  catalog and re-running the seed (spec section 6: "new system roles
  introduced through controlled migrations/seeding," not a runtime API).
- **set** — a custom role, scoped to that one organization,
  `isSystem = false`. Created/edited/deleted through `role-service.ts`
  by a caller holding `roles.create`/`roles.update`/`roles.delete` in
  that organization. Two organizations can each have a custom role with
  the same `key` (e.g. both create `"billing-lead"`) without conflict —
  `@@unique([organizationId, key])` scopes uniqueness per organization.

### The NULL-uniqueness gap, and how it's actually closed

Postgres's standard unique index treats two `NULL`s as distinct values,
so `@@unique([organizationId, key])` alone does **not** stop two system
roles (`organizationId = null`) from sharing a `key` — a second `"owner"`
system role could otherwise be inserted without violating that index at
all. A hand-added partial unique index closes this (not expressible in
Prisma's schema syntax — added directly to the generated migration SQL,
migration `20260816113129_rbac_authorization`):

```sql
CREATE UNIQUE INDEX "roles_system_key_key" ON "roles"("key") WHERE "organization_id" IS NULL;
```

## Platform vs. organization scope

`Role.scope` (`PLATFORM` | `ORGANIZATION`) and `Permission.scope` are
independent axes from `isSystem`/`organizationId` — see `authorization.md`
"Platform vs. organization boundaries" for the runtime enforcement this
data shape supports. The short version: a `PLATFORM`-scope role is only
ever assignable within the one `Organization` row with
`isPlatform = true`; `assignRole()` enforces this at write time, not just
at read time.

### Resolving "who is Alpha Page Rankers" — `Organization.isPlatform`

`tenancy-foundation.md` (Module 03) deliberately left open how to
represent "internal Alpha Page Rankers staff" vs. "an external
organization's members," offering two options. Module 05 resolves it in
favor of option 2 there: Alpha Page Rankers is its own seeded
`Organization` (`isPlatform = true`), and its staff hold `PLATFORM`-scope
roles via ordinary `OrganizationMembership` rows in that one organization
— no second membership table, no `User.type` column, the exact same
relational shape every other organization uses.

**At most one organization may have `isPlatform = true`** — found to be a
real, exploitable gap by this module's own integration test (not just
inspection): `organizationRepository.findPlatformOrganization()` uses
`findFirst()` with no ordering, so a second `isPlatform = true` row made
it non-deterministically resolve the *wrong* platform organization,
silently breaking platform-staff authorization for real accounts. Fixed
with a second hand-added partial unique index (migration
`20260816120000_platform_org_singleton`):

```sql
CREATE UNIQUE INDEX "organizations_single_platform_org" ON "organizations" ((true)) WHERE "is_platform" = true;
```

A unique index on a constant expression (`(true)`), filtered to
`isPlatform = true` rows — every qualifying row has the identical
expression value, so a second one collides. The standard Postgres
pattern for "at most one row matching a condition."

## Deletion safety (spec section 26)

Two independent layers, not one:

1. **Application-level pre-check** (`role-service.ts`'s `deleteRole()`):
   counts memberships still holding the role
   (`roleRepository.countMemberships`) and returns a clean `ConflictError`
   ("reassign them first") before attempting a delete — the friendly
   error path.
2. **Database-level `onDelete: Restrict`**
   (`OrganizationMembership.roleId`'s foreign key): even if the
   application check were ever bypassed by a bug, Postgres itself refuses
   to delete a `Role` row still referenced by a membership. Defense in
   depth, not redundancy — see `data-modeling.md` "Cascade / delete
   behavior" for why this project treats "the DB enforces it too" as a
   real requirement for anything security-sensitive, not just an
   application-code convention.

`RolePermission` rows themselves cascade-delete with their `Role` (a pure
join, no independent value once the role is gone — same reasoning as
`OrganizationMembership`, see `data-modeling.md` "Deletion strategy") —
by the time a `Role` delete reaches that cascade, the pre-check above has
already guaranteed no live membership still depends on it.

## Seeding (spec section 30)

`prisma/seed-rbac.ts`, two independent, idempotent pieces, both called
from `prisma/seed.ts`'s `main()` (before Module 04's own early-return, so
both still run on a repeat `npm run db:seed` invocation):

- **`seedRbac()`** — upserts the permission catalog
  (`src/lib/authorization/permissions.ts`) by `key`, and the system role
  catalog (`src/lib/authorization/roles.ts`) by `(null, key)`, replacing
  each system role's permission grants wholesale from the catalog every
  run. Deterministic, safe to run on every deploy — never touches a row
  with `organizationId` set (an organization's own custom roles), so a
  production re-seed can never silently overwrite what an organization
  built for itself.
- **`seedAuthorizationFixtures()`** — dev-only test fixtures: the one
  platform organization (`alpha-os-platform`) with one account per
  `PLATFORM`-scope system role, plus two independent customer
  organizations ("Acme Corp" / "Beta Industries" — the two-tenant
  fixture spec sections 35–37 require) with one account per
  `ORGANIZATION`-scope role in Org A and two in Org B. Skips entirely
  once the platform organization already exists — safe to re-run, never
  duplicates. All fixture accounts use the password
  `alpha-os-dev-password` (same convention as Module 04's own seed).

Verified idempotent for real: ran twice against a live database in this
module's own build — `permissions`/`roles`/`role_permissions`/`organizations`/
`users` row counts were identical after the second run.

## Permission matrix (spec section 34)

Generated directly from `src/lib/authorization/permissions.ts` and
`roles.ts` (the actual seeded catalog, not hand-transcribed — regenerate
with the script in this doc's source if the catalog ever changes).
`*(reserved)*` — cataloged and seeded, but no resource exists yet for any
role's grant to actually gate (see "Reserved permissions" below).

| permission | platform_owner | platform_admin | support_admin | support_agent | owner | admin | manager | member | viewer | customer |
|---|---|---|---|---|---|---|---|---|---|---|
| users.read *(reserved)* | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| users.create *(reserved)* | ✓ | ✓ |  |  |  |  |  |  |  |  |
| users.update *(reserved)* | ✓ | ✓ |  |  |  |  |  |  |  |  |
| users.delete *(reserved)* | ✓ | ✓ |  |  |  |  |  |  |  |  |
| organizations.read *(reserved)* | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| organizations.update *(reserved)* |  |  |  |  | ✓ | ✓ |  |  |  |  |
| members.read |  |  |  |  | ✓ | ✓ | ✓ |  |  |  |
| members.invite |  |  |  |  | ✓ | ✓ |  |  |  |  |
| members.update |  |  |  |  | ✓ | ✓ |  |  |  |  |
| members.remove |  |  |  |  | ✓ | ✓ |  |  |  |  |
| roles.read | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  |  |  |
| roles.create | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| roles.update | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| roles.delete | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| tickets.read *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tickets.create *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| tickets.update *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| tickets.assign *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ |  |  |  |
| tickets.close *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ |  |  |  |
| projects.read *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| projects.create *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| projects.update *(reserved)* |  |  |  |  | ✓ | ✓ | ✓ | ✓ |  |  |
| projects.delete *(reserved)* |  |  |  |  | ✓ | ✓ |  |  |  |  |
| billing.read *(reserved)* | ✓ |  |  |  | ✓ | ✓ |  |  |  |  |
| billing.manage *(reserved)* | ✓ |  |  |  | ✓ |  |  |  |  |  |
| analytics.read *(reserved)* | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| reports.read *(reserved)* | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ |  | ✓ |  |
| reports.export *(reserved)* | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| settings.read *(reserved)* | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| settings.update *(reserved)* | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |
| ai.use *(reserved)* |  |  |  |  | ✓ | ✓ |  |  |  |  |
| ai.manage *(reserved)* |  |  |  |  | ✓ | ✓ |  |  |  |  |
| integrations.read *(reserved)* |  |  |  |  | ✓ | ✓ |  |  |  |  |
| integrations.manage *(reserved)* |  |  |  |  | ✓ | ✓ |  |  |  |  |
| audit.read *(reserved)* | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |

Regenerate:

```
npx tsx -e "
import { PERMISSION_KEYS, PERMISSION_CATALOG } from './src/lib/authorization/permissions';
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS } from './src/lib/authorization/roles';
const cols = SYSTEM_ROLE_KEYS;
console.log('| ' + ['permission', ...cols].join(' | ') + ' |');
console.log('|' + cols.concat(['permission']).map(() => '---').join('|') + '|');
for (const key of PERMISSION_KEYS) {
  const reserved = PERMISSION_CATALOG[key].reserved ? ' *(reserved)*' : '';
  console.log('| ' + [key + reserved, ...cols.map(c => SYSTEM_ROLES[c].permissions.includes(key) ? '✓' : '')].join(' | ') + ' |');
}
"
```

### Reserved permissions

`tickets.*`, `projects.*`, `billing.*`, `reports.*`, `settings.*` (beyond
`organizations.update`'s basic fields), `ai.*`, `integrations.*`, and
`audit.read` are seeded (so a future module's role-permission
assignments have a real catalog row to reference — and so this module's
role definitions already express sensible defaults for them) but have no
`requirePermission()` call anywhere in Module 05's own shipped code — no
`Ticket`, `Project`, `Invoice`, `Report`, `AiAction`, `Integration`, or
`AuditEvent` resource exists yet to check against. Module 30 (Support),
future project-delivery modules, Module 08 (Audit), Module 17/33 (AI),
and Module 54 (Integrations) are the expected first real callers — see
"Future module compatibility" in this module's completion report.

## Indexes for the authorization hot path (spec section 38)

| Query | Index |
|---|---|
| "This membership's role" | `organization_memberships_role_id_idx` |
| "Every permission this role grants" (checked on every `requirePermission()` call) | `role_permissions_role_id_idx` |
| "Every role granting this permission" (role-editor "who can do X") | `role_permissions_permission_id_idx` |
| "This organization's roles, plus system roles" | `roles_organization_id_key_key` (covers the `organizationId` prefix) + `roles_is_system_idx` |
| "The one platform organization" | `organizations_is_platform_idx` |
| "How many memberships hold this role" (deletion safety) | `organization_memberships_role_id_idx` (same index, `COUNT` query) |

No caching layer yet — see `authorization.md` "Permission caching" for
why, and the invalidation strategy to implement if one is ever added.
