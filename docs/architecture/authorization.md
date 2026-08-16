# Authorization (Module 05)

Enterprise RBAC for Alpha OS: who an authenticated identity is allowed to
act as, and what they may do — the layer above Module 04's authentication
("who is this user?"). See `rbac.md` for the data model this runs on top
of, `tenancy-foundation.md` for the multi-tenant shape it enforces
against, and `authentication.md` for the session layer it never
duplicates.

## Authentication vs. authorization vs. tenancy — three concepts, three modules

```
AUTHENTICATION (Module 04) — who is this user?
        ↓
AUTHORIZATION  (Module 05) — what may this identity do?
        ↓
TENANCY        (Module 06) — which organization/resource boundary applies, enforced in depth?
```

Module 05 never re-implements session verification — every authorization
check starts from `getCurrentUser()`/`getCurrentMembership()`
(`lib/auth/session-guard.ts`, Module 04's own authoritative functions).
Module 05 never implements full tenant isolation either (row-level
security, cross-schema isolation) — it establishes the *application-layer*
pattern (every resource-scoped check verifies organization membership
explicitly) that Module 06 hardens with defense-in-depth. See "Module 05
vs. Module 06" below for the exact boundary.

## Architecture

```
src/lib/authorization/
  permissions.ts   — the permission catalog (single source of truth)
  roles.ts         — the system role catalog (single source of truth)
  context.ts        — resolves WHO + WHICH organization + WHICH role + WHAT permissions, server-side only
  authorize.ts       — can() / cannot() / requirePermission() / authorize()
  errors.ts           — PermissionDeniedError / ResourceScopeError, built on Module 01's AppError
  policies/
    index.ts          — belongsToOrganization, ownedByUser, belongsToOrganizationOrPlatformStaff
```

Every mutating role/permission operation goes through
`src/server/services/role-service.ts` (role CRUD, permission grants, role
assignment) and `membership-service.ts` (member removal/status, sharing
the same last-owner guard) — the one place spec section 18's pattern
("authenticate → resolve authorization context → validate input →
authorize → execute") is implemented, not re-derived per call site.

## Authorization context — never trusts the client

`resolveOrganizationContext(organizationId?)` and `resolvePlatformContext()`
(`context.ts`) are the only two ways an `AuthorizationContext` gets built.
Both derive identity exclusively from Module 04's session
(`getCurrentUser()`) and a database read (`getCurrentMembership()` →
`Role` → `RolePermission` → `Permission`) — **no function in this module
ever accepts `userId`, `organizationId`, `role`, or `permissions` as
trusted input from a request body, query string, or header.** Grepped
across the codebase as part of this module's security review — confirmed
zero such reads exist (see "Security review" below).

```ts
export interface AuthorizationContext {
  user: User | null;
  sessionId: string;
  organizationId: string | null;
  membership: OrganizationMembership | null;
  role: Role | null;
  permissions: Set<PermissionKey>;
  isPlatformStaff: boolean;
}
```

`resolveOrganizationContext()` inherits `getCurrentMembership()`'s
existing "do not guess" rule from Module 04 (spec section 13): an
explicit `organizationId` resolves that specific membership; omitting it
resolves the caller's *sole* membership if they have exactly one, `null`
otherwise. It additionally enforces `membership.status === "ACTIVE"` —
Module 04's `getCurrentMembership()` never needed that distinction,
authorization does (a `SUSPENDED` membership must grant zero permissions
even though its row, including `roleId`, is still intact for when it's
reactivated).

`resolvePlatformContext()` is a dedicated resolver, not "call
`resolveOrganizationContext()` and hope it lands on the platform org" —
it looks up the platform organization
(`organizationRepository.findPlatformOrganization()`) specifically, so a
user who is both platform staff *and* a member of an unrelated customer
organization still resolves correctly (spec section 7's explicit
requirement: "a platform administrator must not accidentally be treated
as an organization owner"). The two contexts' permission sets are never
merged — a caller who needs "is this person also platform staff" reads
`isPlatformStaff` separately, never an implicit OR of two permission
sets.

## The engine: `can` / `cannot` / `requirePermission` / `authorize`

```ts
can(permission, organizationId?)              → boolean, never throws (UX only)
cannot(permission, organizationId?)            → boolean, negation of can()
requirePermission(permission, organizationId?) → AuthorizationContext, throws
authorize(permission, resource, policy, organizationId?) → AuthorizationContext, throws
```

`requirePermission()` — the pattern spec section 11 asks for
(`requirePermission("tickets.assign")` instead of an `if (user.role ===
...)` chain) — routes to the correct resolver **automatically**, using
the permission's own catalog `scope` (`permissions.ts`): a `PLATFORM`
permission resolves `resolvePlatformContext()`, an `ORGANIZATION`
permission resolves `resolveOrganizationContext(organizationId)`. A call
site never has to know or guess which kind of context a given permission
needs.

Throws `AuthenticationError` (401, Module 04's own class — identical to
Module 04's own 401s from a caller's perspective) if there is no session
at all, `PermissionDeniedError` (403, a thin `AuthorizationError`
subclass carrying the permission key in `details` for logs/tests, never
in the client-facing message) if authenticated but lacking the
permission. This distinction is spec section 31's `UNAUTHENTICATED` vs.
`FORBIDDEN`.

## Resource-level authorization — the policy layer (spec section 14)

A permission alone is never sufficient for a specific resource: holding
`projects.read` doesn't mean Customer A may read Customer B's project.
`authorize()` composes a permission check with a `ResourcePolicy<T>`:

```ts
type ResourcePolicy<T> = (context: AuthorizationContext, resource: T) => boolean | Promise<boolean>;
```

Two general-purpose policies ship (`policies/index.ts`) — deliberately
not a larger library (spec section 14: "do not build every future policy
now, build the extension point"):

- **`belongsToOrganization`** — `resource.organizationId === context.organizationId`. The common case.
- **`ownedByUser`** — `resource.userId === context.user.id`. A resource tied to a specific person, not just their organization.
- **`belongsToOrganizationOrPlatformStaff`** — the explicit, auditable version of "platform staff bypass the organization boundary" — never an accidental side-effect of how permission sets are merged (they aren't merged at all; see above). No current resource needs cross-org platform access — this exists as the extension point spec section 21 asks for ("do not implement impersonation/cross-org access now — create the policy extension point only"), not a currently-exercised capability.

Future modules implement their own policy matching `ResourcePolicy<T>` —
"assigned to me," "temporary resource access," a Module 07/30 support
policy with real scoped cross-org rules — without touching `authorize.ts`
itself.

## Platform vs. organization boundaries (spec sections 7/20/21)

Enforced in three independent places, not one:

1. **Context resolution** (above) — platform and organization permission
   sets are resolved and kept separately, never merged.
2. **Role-assignment scope check** (`role-service.ts`'s `assignRole()`) —
   a `PLATFORM`-scope role can only be assigned to a membership inside
   the platform organization; an `ORGANIZATION`-scope role can only be
   assigned outside it. Checked against the actual `Organization.isPlatform`
   flag at assignment time, not inferred from the role's own scope alone.
3. **System role protection** — even a `PLATFORM_OWNER` cannot redefine
   what "owner" or "platform_admin" means for every organization/the
   whole platform at once through a runtime action (see `rbac.md`
   "System roles vs. custom roles") — that requires an auditable code
   change (`roles.ts`) plus a seed re-run, never a UI mutation.

**Support access** (spec section 21) — `support_admin`/`support_agent`
hold a deliberately minimal platform-wide permission set
(`users.read`, `organizations.read` — see `roles.ts`) and nothing
org-scoped. Cross-organization support access (ticket access, temporary
elevated access, impersonation with audit) is explicitly **not**
implemented — the policy extension point (`ResourcePolicy<T>`,
`belongsToOrganizationOrPlatformStaff`) exists for a future module to
build a real scoped-access policy on top of, without Module 05 having
guessed at its shape.

## Privilege escalation defense (spec sections 24/25)

All of `role-service.ts`'s `assignRole()` — the single chokepoint every
role change goes through:

1. **Permission gate**: `members.update` in the target membership's own
   organization. `CUSTOMER`/`VIEWER`/`MEMBER` never hold this permission
   (see `roles.ts`'s catalog) — every escalation attempt in spec section
   25's list (`CUSTOMER → ADMIN`, `MEMBER → OWNER`, `VIEWER → ADMIN`)
   fails here, before any other check runs. Verified with real Postgres
   data, not just by inspection — see "Tests" below.
2. **Scope compatibility** — a platform-scope role is inadmissible
   outside the platform organization regardless of who's assigning it,
   closing the `SUPPORT_AGENT → PLATFORM_ADMIN` and
   `ORGANIZATION_ADMIN → PLATFORM_ADMIN` paths even in a hypothetical
   where an org actor somehow held a platform-scoped permission — they
   still can't reach a membership inside the platform organization to
   assign it to (no membership there resolves for `requirePermission()`).
3. **Custom-role organization match** — a custom role assigns only within
   the organization that created it.
4. **Last-owner protection** (below).

No separate "can't grant a role higher than your own" rule exists beyond
the permission gate itself — deliberately: the gate (only `owner`/`admin`
hold `members.update`) already is the "explicit authorization" spec
section 24 requires ("`ORGANIZATION_MEMBER` cannot assign themselves
`ORGANIZATION_OWNER` **unless explicitly authorized**").

## Last-owner protection (spec section 27)

`role-service.ts`'s `wouldRemoveLastOwner(organizationId, membershipId,
newRoleKey)` — true only when the membership currently holds `owner`,
the new role/state is something else, and no other `ACTIVE` membership in
that organization also holds `owner`. Shared by three operations, not
reimplemented per call site:

- `assignRole()` — reassigning the last owner to any other role.
- `membership-service.ts`'s `removeMember()` — removing the last owner.
- `membership-service.ts`'s `updateMemberStatus()` — suspending the last owner.

All server-side, unconditional — no permission level bypasses it, since
the risk (an organization with zero owners) is the same regardless of who
triggers it.

## Server-first authorization (spec section 16)

Every check in this module runs server-side; nothing in
`src/lib/authorization/` is imported by a client component for a
*decision* — only permission *names* (plain string constants,
`permissions.ts`) are safe to reference client-side for UI rendering
(disabling a control, hiding a button). `role-assignment-form.tsx`
disables its `<select>`/submit button based on a server-resolved
`canManageMembers` boolean passed down as a prop — but this is UX only.
Proven, not assumed: this module's E2E suite force-enables the disabled
control via `page.evaluate()` and submits anyway — the server
independently rejects it every time (see "Tests").

## Permission caching (spec section 28)

Not introduced. Every `requirePermission()` call does a real read
(`Role` → `RolePermission` → `Permission`, indexed — see `rbac.md`
"Indexes"). If a cache is added later: key by `(userId, organizationId)`
or `roleId`, invalidate synchronously inside the same transaction as any
`RolePermission` write, `Role` permission-set replacement, or role
(re)assignment — never let a cached permission set survive a
security-critical change, even briefly. A TTL-only cache without explicit
invalidation on write is not acceptable for this data.

## Module 05 vs. Module 06 (multi-tenancy)

| | Module 05 (this module) | Module 06 (future) |
|---|---|---|
| Scope | Application-layer authorization: is this permission held, does this resource belong to the caller's organization | Defense-in-depth tenant isolation: Postgres RLS, connection-level tenant context, cross-schema/cross-database isolation if ever needed |
| What exists today | Every resource-scoped check explicitly verifies `resource.organizationId === context.organizationId` (`belongsToOrganization`) in application code | Nothing yet — `tenancy-foundation.md` (Module 03) documents why RLS wasn't enabled before an auth model existed to write policies against |
| What must not be duplicated | — | A second, competing authorization decision layer. Module 06 should strengthen enforcement of decisions Module 05 already makes (e.g. RLS policies that mirror `belongsToOrganization`'s own logic), not introduce a different notion of "who can act on this row." |

## Security review

Performed against the actual running application and a real local
Postgres — not by inspection alone. See "Vulnerabilities found and
fixed" in this module's completion report for the two real issues this
review surfaced (the platform-organization singleton gap, and the
now-superseded reasoning trail that led to it) and how each was verified
fixed by rerunning the exact attack that found it.

- **Privilege escalation** — the full spec section 25/37 matrix
  (`CUSTOMER → ADMIN`, `MEMBER → OWNER`, `VIEWER → ADMIN`,
  `SUPPORT_AGENT → PLATFORM_ADMIN`, `ORG_ADMIN → PLATFORM_ADMIN`) run
  against real `role-service.ts` functions with real Postgres data —
  every attempt denied. Also driven through the real browser, DOM-forcing
  a disabled UI control and submitting anyway — still denied server-side.
- **Cross-tenant access** — Org A's owner attempting to reassign a role
  on Org B's membership, and to delete Org B's custom role: both denied
  (the second as a `404`, not a `403` — see below).
- **IDOR / IDOR-shaped enumeration** — a request for a role/membership
  outside the caller's own organization returns `NotFoundError` (404),
  not `AuthorizationError` (403) — spec section 31's explicit
  enumeration-avoidance instruction: confirming "that role exists,
  you're just not allowed to touch it" is itself a disclosure.
- **Role manipulation / deletion vulnerabilities** — a system role can
  never be updated or deleted at runtime (protected twice: the org-scope
  lookup itself 404s for a `organizationId: null` row, and
  `assertNotSystemRole()` stands as explicit defense-in-depth); a custom
  role still assigned to a member cannot be deleted (`ConflictError`,
  backed by a DB-level `Restrict` foreign key).
- **Owner removal vulnerabilities** — the last owner cannot be demoted,
  removed, or suspended; verified with automated tests, not just
  reasoning about the code.
- **Frontend-only authorization** — none found; grepped every
  `formData.get(...)` call site in the app (inherited from the Module 04
  audit, re-verified for this module's new code) — no code path reads
  `organizationId`/`userId`/`role`/`permission` from client input
  anywhere.
- **Server/client boundary** — `src/lib/authorization/permissions.ts` and
  `roles.ts` are deliberately importable from client components (plain
  data, safe to reference for UI capability rendering); everything else
  in `src/lib/authorization/` and `src/server/services/role-service.ts`
  imports `"server-only"`. `npm run build` — the same real check that
  caught a genuine boundary violation during Module 04's build — passes
  clean.

## UI (spec section 33)

`/admin/roles` — a minimal, real demonstration, not a generic CRUD
screen: a role catalog table (`DataTable`-adjacent native table +
`StatusBadge` for scope/type) and, for an organization-scope viewer, a
member list with a role-assignment control. Deliberately reached at a
**new** route rather than retrofitted onto the existing
`(protected)/admin/page.tsx` — Module 04's own seeded accounts predate
Module 05's role system (`roleId` is `null` for them — see `rbac.md`) and
are exercised by Module 04's own passing E2E suite; gating the *existing*
placeholder page here would have regressed those tests. The
role-assignment control is a plain `<select>`, not the Radix-based
`Select` primitive — specifically so a Server Action can read
`formData.get("roleId")` directly, without client-side state syncing.

## Tests

See the completion report for exact counts. Coverage spans: direct
service-layer tests against real Postgres with a mocked identity (the
same technique Module 04's own security audit established for
`session-guard.test.ts`) covering the full escalation/cross-tenant/
last-owner matrix; a context/engine test file covering PLATFORM vs.
ORGANIZATION resolution and the `SUSPENDED`-membership-grants-nothing
case; and a real-browser E2E suite (no mocked authentication) covering
per-persona visibility, the DOM-forced-escalation attempt, cross-tenant
UI isolation, and unauthenticated route access — plus axe-core across
three personas × two themes × three viewports on the new UI.
