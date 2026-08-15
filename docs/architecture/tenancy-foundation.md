# Tenancy Foundation (Module 03)

Module 06 (Multi-Tenancy) owns the complete tenant-isolation behavior —
this module establishes the database shape that makes Module 06 possible
without a schema rewrite, per the spec's explicit ask. This doc explains
that shape and the decisions deliberately deferred to later modules.

## Why membership, not `User.organizationId`

A single `organizationId` column on `User` can only represent a user
belonging to exactly one organization. Alpha OS's real shape is:

```
Organization A                    Organization B
    ├── User 1                        ├── User 2
    ├── User 2  ←── same person ──────┘
    └── User 3
```

`User 2` legitimately belongs to both — an agency employee who's also a
customer of their own side project, a consultant working with multiple
client organizations, or (see "Internal vs. customer users" below) an
Alpha Page Rankers staff member whose own "organization" is Alpha Page
Rankers itself. `OrganizationMembership` is the join table that makes
this representable: `User` and `Organization` are independent entities,
and a row in `OrganizationMembership` is what connects a specific person
to a specific organization, with its own status and role.

This is also why `OrganizationMembership` has its own `id`, not a
composite primary key of `(organizationId, userId)` — a future module
(notifications, audit) may need to reference "this specific membership"
directly, which a composite key makes awkward.

## Role/permission foundation — the deliberate extension point

Module 05 (RBAC) owns the actual permission system. This module commits
to exactly one thing: `OrganizationMembership.role` is a plain string
column holding a role **key** (`"owner"`, `"admin"`, `"member"` — see
`SYSTEM_MEMBERSHIP_ROLES` in `membership-repository.ts`), not a Postgres
enum and not yet a foreign key.

**Why not a `Role`/`Permission` table now**: the spec is explicit that
full RBAC is Module 05's job, and a premature `Role` table designed
without knowing Module 05's actual permission model (Is it purely
role-based? Attribute-based? Does it need per-organization custom roles
from day one, or is that a v2?) risks guessing wrong and requiring a
rewrite anyway — the exact failure mode a "foundation" module should
avoid causing, not just avoid experiencing.

**Why not a Postgres enum**: an enum can't represent organization-defined
custom roles at all (every enum value is global, not per-org), and
`ALTER TYPE ... ADD VALUE` has real operational restrictions (can't run
inside a transaction with other DDL in most Postgres versions). A plain
string has neither limitation.

**The migration path when Module 05 lands**: add a `Role` table (global
system roles + optionally organization-scoped custom roles, keyed by the
same string values already in use — `"owner"`, `"admin"`, `"member"`
become real rows, not just documented conventions), then a follow-up
migration adds a foreign key from `OrganizationMembership.role` to it (or
introduces a separate `roleId` column and deprecates `role` via the
expand/contract pattern in `migrations.md`). Nothing about the current
schema blocks either direction.

## Internal (Admin/Support) vs. customer users — an open question, not a defect

The original three-portal concept (Admin / Support / Customer) implies
two different *kinds* of user: Alpha Page Rankers' own internal staff,
and external clients. This schema doesn't encode that distinction yet,
and deliberately doesn't guess at the answer — both of the following are
representable without a schema change, and which one is correct is a
Module 05/06 decision informed by how authentication and authorization
actually need to check it:

1. **A `User.type` (or similar) column** — `INTERNAL` vs. `CUSTOMER` — a
   property of the person, independent of which organizations they
   belong to.
2. **Alpha Page Rankers as its own seeded `Organization`** — internal
   staff are members of that organization with `admin`/`support`-ish
   roles; every client is a separate `Organization`. "Is this an internal
   user" becomes "does this user have a membership in the Alpha Page
   Rankers organization," not a separate column.

Flagging this explicitly rather than silently picking one — see "Future
module compatibility" in the Module 03 completion report.

## Row-level security: not enabled, deliberately

Supabase's Postgres supports RLS (row-level security) policies, which
would let the database itself enforce "a query can only see rows for
organizations the current user belongs to" — a genuinely strong
tenant-isolation mechanism. It is **not** enabled in Module 03.

Why: RLS policies need to know who "the current user" is *inside
Postgres* (typically via a session variable or JWT claim Supabase Auth
sets automatically) — but Alpha OS hasn't adopted Supabase Auth, and
Module 04's actual authentication mechanism isn't decided yet. Enabling
RLS now would mean designing policies against an auth model that might
not be the one Module 04 ships. The interim isolation model, until
Module 06:

- Every future business-entity table gets an `organizationId` foreign
  key (directly, or transitively through a parent).
- Every repository query for that entity filters by the caller's
  `organizationId` **explicitly, in application code** — never a query
  that trusts a client-supplied org ID without checking the caller
  actually has a membership in it.
- This satisfies design principle 14 ("tenant isolation must be
  enforceable at the application layer") without foreclosing RLS as a
  *defense-in-depth* addition once Module 04/06 settle the auth model —
  RLS as a second layer under an already-correct application layer is a
  reasonable Module 06 addition, not a replacement for one.

## Audit foundation — recommended shape, not implemented

Module 08 (Audit) owns the real audit-logging system. No `AuditEvent`
table exists yet — creating one now, before knowing what Module 08's
actual query patterns and retention requirements are, risks the same
premature-design problem as the Role table above. The recommended shape
to evaluate when that module starts:

```
AuditEvent
  id            uuid
  organizationId uuid?        -- null for system-level events with no org context
  actorId        uuid?        -- null for system-initiated events (a cron job, a webhook)
  action         text         -- "organization.created", "membership.role_changed", ...
  entityType     text         -- "Organization", "OrganizationMembership", ...
  entityId       uuid
  requestId      text?        -- correlates to the request-id already threaded through lib/platform
  beforeState    jsonb?        -- only where genuinely useful (a role change, not every event)
  afterState     jsonb?
  metadata       jsonb?
  createdAt      timestamptz
```

Indexing considerations for that future table: `(organizationId,
createdAt)` for "this org's recent activity," `(entityType, entityId,
createdAt)` for "this specific record's history," and a retention policy
decision (partition by month? a separate cold-storage table after N
months?) before it accumulates enough rows for either to matter — not
something to guess at in Module 03.

Foreign keys from `AuditEvent` to `Organization`/`User` must use
`RESTRICT` or `SET NULL`, never `CASCADE` (see `data-modeling.md`
"Cascade / delete behavior") — an audit trail that disappears when the
thing it's auditing is deleted has failed at the one job it exists to
do.

## System metadata / settings

No generic key-value settings table exists. `Organization.metadata`
(JSONB) covers per-organization flexible settings today; a genuinely
system-wide (not per-org) settings need hasn't appeared yet. Adding a
`SystemSetting` table speculatively, before a real consumer needs it,
would be exactly the "giant generic everything table" the spec warns
against — deferred until a module actually needs it.
