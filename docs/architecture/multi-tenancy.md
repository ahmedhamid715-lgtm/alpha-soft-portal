# Multi-Tenancy & Organization Isolation (Module 06)

The application layer of Alpha OS's defense-in-depth tenant isolation.
See `rls.md` for the database layer underneath this, `authorization.md`/
`rbac.md` for the RBAC engine this builds on, and `tenancy-foundation.md`
(Module 03) for the original schema decisions this module resolves the
open questions of.

```
IDENTITY → AUTHENTICATION (04) → AUTHORIZATION (05) → TENANT CONTEXT (06)
    → APPLICATION-LEVEL ISOLATION (06) → DATABASE-LEVEL RLS (06) → PostgreSQL
```

## Terminology (spec section 3)

| Term | Meaning |
|---|---|
| **Platform** | Alpha Page Rankers / Alpha OS itself — the one `Organization` row with `isPlatform = true` (Module 05's resolution of Module 03's open "internal vs. customer" question — see `rbac.md`) |
| **Organization** | A tenant — a customer, a company, a business operating inside Alpha OS. Every non-platform `Organization` row. |
| **User** | A human identity (Module 04). Global, not owned by any one organization — the entire reason `OrganizationMembership` exists (Module 03). |
| **Membership** | The `User` ↔ `Organization` relationship, with its own role and status. |
| **Resource** | A business object belonging to an organization — none exist yet in Alpha OS's shipped scope (see "Tenant ownership classification" below); this module establishes the pattern every future one follows. |
| **Platform resource** | A resource intentionally owned by the platform, not any organization. None exist yet either, for the same reason. |

## Tenant ownership classification (spec section 4)

Every model in the actual schema, audited — not "add `organizationId` to
everything," per the spec's own explicit instruction:

| Model | Classification | RLS? | How access is determined |
|---|---|---|---|
| `Organization` | **Tenant root** — not owned *by* a tenant, it *is* one | Not yet — see `rls.md` "Tables deliberately without RLS" for the exact, deliberate reason | Membership existence (application-level: `membershipRepository`) |
| `OrganizationMembership` | **Organization-owned** | Yes (Module 06) | `organizationId` column, RLS-enforced |
| `Role` | **Organization-owned** (custom, `organizationId` set) **or global reference data** (system, `organizationId IS NULL`) | Yes (Module 06) | Same column doing double duty as classifier and scope |
| `RolePermission` | **Organization-owned**, transitively (no own `organizationId`) | Yes (Module 06, via `roles` join) | Inherits `Role`'s classification |
| `Permission` | **Global / shared reference data** | No | The seeded catalog — same content for everyone |
| `User` | **User-owned** (a person's own identity, not organization data) | No — see `rls.md` for why RLS here would be circular with Module 04's own authentication path | Module 04's session (`getCurrentUser()`) |
| `UserCredential`, `UserSession`, `AuthToken` | **User-owned / system infrastructure** | No, same reason as `User` | Scoped to the owning user by Module 04's own logic, not organization at all |

No model in the current schema is genuinely ambiguous or unclassifiable
— spec section 31's "STOP and report" escape hatch wasn't needed. The
short list above is a direct consequence of Alpha OS having exactly nine
models total as of this module (Organization/User/OrganizationMembership
from Module 03, UserCredential/UserSession/AuthToken from Module 04,
Role/Permission/RolePermission from Module 05) and zero real business
resources yet — CRM records, projects, tickets, invoices are all future
modules' job. **This module's real deliverable is the infrastructure and
pattern those future modules plug into**, proven correct against the one
genuinely organization-owned table that exists today
(`OrganizationMembership`), not a large set of newly-classified business
tables that don't exist yet.

### The pattern future modules follow

When Module 07+ adds a real organization-owned resource (a `Project`, a
`Ticket`, an `Invoice`):

1. `organizationId String @db.Uuid` — a direct foreign key, `NOT NULL`
   unless there's a documented reason otherwise (spec section 32).
2. Index `organizationId` and `(organizationId, <common lookup key>)` /
   `(organizationId, createdAt)` / `(organizationId, status)` per its
   actual query patterns (spec section 33) — don't guess, measure.
3. Add an `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` +
   four policies (SELECT/INSERT/UPDATE/DELETE) migration, following
   `rls.md`'s exact shape for `organization_memberships`/`roles`.
4. Route every mutation through `withTenantContext()`
   (`lib/tenancy/context.ts`), using an already-verified
   `AuthorizationContext` from `requirePermission()` — see
   `role-service.ts`'s `tenantInputFor()` helper for the pattern.
5. Repository reads for "a specific resource by id" should resolve
   ownership from the database, never trust a client-supplied
   `organizationId` to select the row (spec sections 19/28) — see
   "Repository safety" below.

## Organization context (spec section 7)

**Module 05's `resolveOrganizationContext()`/`resolvePlatformContext()`
are the only context resolvers — Module 06 does not create a second
one.** It extends them (their own explicitly-documented invitation, spec
section 7: "Extend it only if necessary") in two ways:

1. Their membership/role/permission reads now run inside
   `withTenantContext()` — RLS-protected, not just application-checked
   (see "Application-level isolation" below and `rls.md`).
2. `resolveOrganizationContext()` now also rejects a non-`ACTIVE`
   **organization** (not just a non-`ACTIVE` **membership**, which it
   already checked) — a real gap this module's own E2E test found: the
   function fetched the `Organization` row only to read `isPlatform`,
   never checking `status`, so a `SUSPENDED`/`ARCHIVED` organization's
   members kept full permissions as long as their own membership stayed
   `ACTIVE`. See "Vulnerabilities found and fixed" in this module's
   completion report.

Neither change alters the function's signature or its contract for
existing callers — Module 05's own full test suite (194 tests) passes
unmodified against both changes.

## Organization selection & switching (spec sections 8/36)

`src/lib/tenancy/organization-selection.ts` — `/organizations`
(`(protected)/organizations/`) lists every organization a user belongs
to; `switchOrganizationAction` sets which one is "current."

**The cookie is a hint, never a trust boundary.** Both
`getSelectedOrganizationId()` (read) and `selectOrganization()` (write)
independently call `getCurrentMembership()` — the same real,
database-backed check `resolveOrganizationContext()` itself uses — before
trusting the value. A stale, forged, or stolen cookie naming an
organization the caller doesn't belong to, or one that's gone
`SUSPENDED`/`ARCHIVED`, resolves to `null`, exactly as if unset. Proven
live, not just asserted: an E2E test forges the switch form's hidden
`organizationId` field (via `page.evaluate`) to an organization the
authenticated user genuinely doesn't belong to and submits anyway — the
server independently rejects it.

Switching **never** touches `User`/`UserSession`/`UserCredential` — only
this one cookie. It cannot alter the caller's authenticated identity
(spec section 8's explicit requirement), and permissions are always
recalculated fresh from the newly-selected organization's real
membership on the very next request — proven with a multi-org fixture
account (`multiorg@alpha-os.test`, admin in one organization, viewer in
another, spec section 23's exact example) whose visible `/admin/roles`
content changes correctly on each switch, including denying access
entirely when the role in the newly-selected organization doesn't carry
`roles.read`.

## Session + tenant context (spec section 9)

No mutable tenant-authorization state lives in the JWT — unchanged from
Module 04/05. The authoritative chain remains `UserSession` (Module 04)
`+ OrganizationMembership + Organization + Role + Permissions` (Module
05/06), re-resolved from the database on every `requirePermission()`
call, never cached in the token. A membership `SUSPENDED` or removed
mid-session takes effect on the caller's very next request — proven live
via a real browser: a membership row deleted directly in Postgres while
its owner has a fully valid, unexpired browser session immediately loses
access to that organization, with no logout/login required.

## Application-level isolation (spec sections 27–29)

Every mutation in `role-service.ts`/`membership-service.ts` runs inside
`withTenantContext()`, using the `AuthorizationContext`
`requirePermission()` already independently verified — never a
re-derived or client-supplied `organizationId`. This is what makes the
actual database writes RLS-protected (see `rls.md`), not just the read
that decided whether to allow them.

**The service layer works identically from any caller** — a Server
Action, a Server Component, a future Route Handler, or a future
background job — because none of it depends on an HTTP request object.
`getCurrentUser()` (Module 04) is the only piece that's currently
request-scoped (it reads the session cookie via `next/headers`); every
service function below that point takes plain arguments and returns
plain values.

### Background job contract (spec section 26) — documented, not built

No job system exists yet (Module 01's `lib/platform/jobs.ts` is an
inline, non-durable stub with no real consumers). The contract a future
job system must follow, so a job never silently executes tenant work
with an unknown or wrong tenant:

- A job payload must carry an explicit `organizationId` (or an explicit
  `platform` marker) — never infer it from "whoever enqueued this" or a
  default.
- A job handler establishes its own `withTenantContext()` using that
  payload value directly — it does **not** call
  `resolveOrganizationContext()` (which depends on a live, authenticated
  session `getCurrentUser()` reads — a job has no session) or otherwise
  try to resolve "the current user," since a job isn't running as any
  particular user's request.
- If a job's tenant context is missing or invalid, it must fail loudly
  (and be retried/dead-lettered by the job system, per whatever policy
  Module 38/54 eventually build) — never fall back to "process it
  without tenant scoping."

### Internal service safety (spec section 27)

Confirmed by construction, not by exception-handling: every function in
`src/lib/tenancy/` and `src/server/services/role-service.ts`/
`membership-service.ts` is a plain async function taking explicit
arguments — none of it imports `next/server`, reads a `Request` object,
or otherwise assumes an HTTP context (the one exception,
`organization-selection.ts`, explicitly needs `next/headers`'s
`cookies()` and is not part of the tenant-context chokepoint itself —
see its own module boundary in `lib/tenancy/index.ts`'s barrel export,
and why `rls.test.ts` imports `withTenantContext` directly rather than
through that barrel, to stay runnable outside Next's bundler).

### Repository safety (spec section 28)

Audited every existing repository for "accepts a resource id without
organization context": `membershipRepository.findById(id)` and
`roleRepository.findById(id)` both do exactly this — by design, not an
oversight. Both are used as the **first step** of an authorization flow
(`role-service.ts`'s `assignRole()`: "look up which organization this
membership claims to belong to, so `requirePermission()` can check the
caller's *real* access to that organization") — the lookup itself
grants nothing; nothing is read from or written to the row until
`requirePermission()` has independently re-verified the caller's access
against the organization that specific row actually has. An attacker
supplying a `membershipId`/`roleId` from a foreign organization learns
only "a row with this id nominally exists, in some organization" before
failing at the real authorization gate — not a `findByIdWithinOrganization()`-shaped
scoped-lookup pattern, because the organization to scope by isn't known
yet at that point; the shape here is "discover, then independently
verify," documented explicitly at each call site
(`role-service.ts`'s `assignRole()` has the exact reasoning inline).

### Global queries (spec section 29)

Two exist, both intentional and clearly named: `organizationRepository.findPlatformOrganization()`
(returns the platform organization regardless of caller — used only by
`resolvePlatformContext()`, which then still requires a real, `ACTIVE`,
platform-org membership before granting anything) and
`roleRepository.listSystemRoles()`/`findSystemRoleByKey()` (system roles
are global reference data by design — see the ownership table above, not
a platform-scoped operation that leaked). Neither is a normal tenant
repository method that accidentally became global; both are the correct
shape for querying genuinely global data.

## Cache isolation (spec sections 34/35)

`lib/platform/cache.ts` (Module 01) has **zero consumers** anywhere in
the codebase as of this module — no tenant data has ever been cached, so
there is nothing to audit for a leak today. Documented convention for
whichever future module first uses it: a tenant-scoped cache key **must**
include the `organizationId` boundary (`` `projects:${organizationId}:list` ``,
never `"projects:list"`), and a user-specific cache must include the
user's id where relevant, mirroring exactly the shape `rls.md`'s context
functions already enforce at the database layer. No client-side
(React/browser) state currently stores organization data either — the
`/admin/roles` and `/organizations` pages are Server Components,
re-fetched fresh from the server on every navigation; there is no
client-side cache to clear on switch. If a future module introduces
client-side tenant-scoped caching (e.g. a client Query cache), switching
organizations must invalidate or key-scope it the same way — documented
here as the contract, not yet a problem that exists.

## Platform vs. tenant isolation (spec sections 24/25)

Platform-organization membership is **not** universal access — proven
directly, not assumed: `platform_admin`'s and `support_agent`'s seeded
permission grants (`roles.ts`) never include organization-scoped
permissions (`members.*`, `tickets.*`, etc.) at all; a platform staff
member has no path to a customer organization's private data through
the permission system as it exists today. `isPlatformStaff` is resolved
independently per context (never merged with a specific organization's
own permission set — see `authorization.md`) and, for RLS specifically,
is set to `true` only *after* a real, `ACTIVE` platform membership is
verified (`setTenantPlatformStaff()`, `rls.md`) — never assumed
optimistically. If a future module needs real cross-organization support
access, it's an explicit, new, auditable policy
(`belongsToOrganizationOrPlatformStaff`, already scaffolded in Module
05's `policies/`) — not a default anyone gets by being in the platform
organization.

## Module 05 vs. Module 06 boundary — restated

Module 05 decides **what** a permission-holder may do. Module 06 decides
**which tenant boundary** that decision is evaluated within, and adds
the database-level backstop for when application code gets that wrong.
Neither replaces the other — see `authorization.md`'s own "Module 05 vs.
Module 06" table, which this module's actual implementation matches
exactly.
