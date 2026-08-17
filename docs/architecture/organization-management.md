# Organization Management

Module 07. Everything an authorized caller does *to* an organization or its
members — creation, profile, lifecycle, member directory, role assignment,
ownership transfer. Invitations get their own file (`invitations.md`).
Nothing here duplicates Module 05 (authorization engine), Module 06
(tenant context/RLS), or Module 04 (authentication) — every mutation below
is a thin service function that calls `requirePermission()` and
`withTenantContext()`, the same chokepoints every earlier module built.

## One source of truth (spec section 2)

There is no `OrganizationV2`, no second `Member` table, no second
authorization engine. `organization-management-service.ts` (Module 07,
authorized operations) and `organization-service.ts` (Module 03's original
`createOrganizationWithOwner`, kept free of the auth import chain so
`prisma/seed.ts` stays loadable under bare `tsx`) both write the exact same
`Organization`/`OrganizationMembership`/`Role` rows through the exact same
repositories — this is a module-loading boundary, not a competing data
model. See that file's own top comment for the full story.

## Organization profile

Evaluated against the existing schema rather than blindly extended: `name`
already serves as the "legal/internal name" field (its own doc comment
says so), so Module 07 did **not** add a redundant `legalName`. New
nullable fields added: `logoUrl`, `website`, `industry`, `country`, `phone`,
`primaryEmail`. `slug` changes go through the same uniqueness check as
creation — the database `id` stays canonical; nothing else keys off the
slug except URL routing.

## Organization creation (spec section 28)

`organizations.create` is **PLATFORM-scope**, held only by
`platform_owner`/`platform_admin` — Alpha OS has no public self-service
org signup. `createOrganization()`'s transaction is atomic: organization +
first owner membership (with a real `roleId`, not just the legacy role
string) + an `OrganizationOnboarding` row, all in one `withTenantContext()`
call, or none of it.

**Tenant context during creation**: the transaction opens with
`organizationId` set to the new organization's *already-known* id
(generated before any row is written) — the `INSERT` policies are
satisfied because the row being written IS what defines the context. No
RLS bypass, no special bootstrap mode; see `rls.md`'s identical reasoning
for invitation acceptance.

**The creator has no membership in what they just created.** Only the
invited owner does. `createOrganizationAction` deliberately does **not**
redirect the creator into the new organization's `/onboarding` — a real
bug caught by this module's own E2E testing: the redirect target 404'd,
because `resolveOrganizationContext()` correctly finds zero permissions for
someone with no membership at all. The action now returns a plain success
confirmation instead; onboarding is the new owner's own flow, experienced
when *they* first sign in.

## Organization lifecycle (spec section 23)

Reuses Module 06's existing `ACTIVE`/`SUSPENDED`/`ARCHIVED` states — no new
enum. Suspend and archive are **organization self-service**
(`organizations.update`, the same permission profile-editing needs — an org
may deactivate itself). Reactivate is deliberately different:

> A suspended organization's own owner has **zero** `organizations.update`
> — `resolveOrganizationContext()` zeroes ALL permissions for a non-`ACTIVE`
> organization (spec section 21). Reactivation via `organizations.update`
> would therefore be permanently impossible — a real deadlock this
> module's own testing caught, not a hypothetical. `organizations.reactivate`
> is a dedicated, narrower, **PLATFORM-scope** permission (platform staff
> only) instead — consistent with the same "new narrow permission over
> broadening an existing one" precedent `ownership.transfer` set. It's also
> arguably the more correct design regardless of the deadlock: an
> organization suspended for cause shouldn't be able to un-suspend itself.

No hard delete anywhere — archiving is the only "removal" an organization
gets (spec section 22).

## Member directory & detail (spec sections 9/10)

`/organizations/[id]/members` — searchable (name **and** email; an early
version only indexed the `name` column's value, so searching an email
substring silently returned "No members yet" — found by this module's own
E2E testing, fixed by making the DataTable column's filterable value
`"${name} ${email}"`), sortable, paginated, all via the existing `DataTable`
(Module 02) — no bespoke table component.

Clicking "Manage" opens a read-only-capable detail `Sheet` — it's rendered
for anyone with `members.read` (e.g. a `manager`, who can see the roster
but not touch it), and every mutation control inside it is independently
disabled/hidden based on the caller's actual permissions
(`members.update`/`members.remove`), never assumed from who could see the
button. The Sheet never renders a password hash, credential, or session
token — there is no such field on `MemberDetail` to accidentally expose.

## Role assignment

Reuses Module 05's `assignRole()` (`role-service.ts`) exactly —
`/organizations/[id]/members`'s role `Select` posts to a new Server Action
that calls the same function `/admin/roles` already used. No parallel
role-assignment logic exists. `assignRole()`'s own last-owner protection,
scope-compatibility check, and custom-role-organization-match check all
apply unchanged.

## Ownership transfer (spec sections 20/21/34/46)

`ownership-transfer-service.ts`'s `transferOwnership()`:

- **Owner-only**: a dedicated `ownership.transfer` permission, granted only
  to the `owner` role (not `admin`, which holds the rest of
  `ORGANIZATION_FULL`) — a narrower permission introduced specifically for
  this, not a reuse of the broader `members.update`.
- **`fromMembershipId` is never client-supplied** — always derived from the
  caller's own verified `AuthorizationContext.membership.id`. This closes
  the "forge which membership is transferring away" IDOR at the schema
  level: the input type has no such field.
- **Race-safe**: `SELECT ... FOR UPDATE` locks the organization row before
  re-validating the caller is still the current owner (a concurrent
  transfer may have already committed while waiting for the lock) —
  proven with a real two-tab-racing Playwright test, not just a Vitest
  service-level one.
- **UI confirmation is a genuinely separate step** — picking a target in
  the `Combobox` only opens a `ConfirmDialog`; nothing transfers until that
  second, explicit confirm.
- **Toast, not inline text, for the success message** — a successful
  transfer means the caller is no longer the owner, so the settings page's
  own `isOwner` check unmounts the entire ownership-transfer section (and
  any inline success message with it) on the very next revalidated render.
  A `useEffect` reacting to action state can lose this exact race too (the
  unmount can land in the same React commit as the state update); calling
  `transferOwnershipAction()` directly and firing `toast.success()` the
  moment the awaited promise resolves has no such race. Found and fixed via
  this module's own E2E testing, not by inspection.

## Authorization matrix

Documentation only — **never** hardcoded into the app as an `if (role ===
...)` branch anywhere. The real enforcement is Module 05's permission
catalog (`src/lib/authorization/permissions.ts`, `roles.ts`); this table is
a reference, generated by reading that catalog, not a second source of
truth.

| Action | Permission | `owner` | `admin` | `manager` | `member` | `viewer` | `customer` |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View member list | `members.read` | ✓ | ✓ | ✓ | | | |
| Invite a member | `members.invite` | ✓ | ✓ | | | | |
| Change a member's role | `members.update` | ✓ | ✓ | | | | |
| Suspend/reactivate a member | `members.update` | ✓ | ✓ | | | | |
| Remove a member | `members.remove` | ✓ | ✓ | | | | |
| Update organization profile | `organizations.update` | ✓ | ✓ | | | | |
| Suspend/archive the organization | `organizations.update` | ✓ | ✓ | | | | |
| Reactivate a suspended organization | `organizations.reactivate` | | | | | | *(platform staff only — see Lifecycle above)* |
| Transfer ownership | `ownership.transfer` | ✓ | | | | | |
| Create a new organization | `organizations.create` | | | | | | *(`platform_owner`/`platform_admin` only)* |
| List organizations platform-wide | `organizations.read` | | | | | | *(platform staff only)* |

## Platform-wide administration (Module 11)

Everything above is either self-service (an organization managing
itself) or platform-only-because-of-a-deadlock (`organizations.reactivate`).
Module 11 adds the platform-staff-facing directory and detail view —
`/admin/organizations` and `/admin/organizations/[id]` — reusing
`listOrganizationsForPlatform()`/`getOrganizationForPlatform()`
(extended/added in `organization-management-service.ts`, this same
file) rather than a second organization-listing system. See
`organization-lifecycle.md` for the real reachability bug this closes
and `organization-security.md` for the full trust model.

`listOrganizationsForPlatform()` was extended from its original offset-
paginated shape to cursor pagination + search/status filter — the exact
same "an unbounded platform dataset must not use offset pagination"
reasoning `user-management.md`'s own directory decision documents for
Module 10. `getOrganizationForPlatform()` is new: identity, current
owner (name/email only), and a bounded membership-status count — never
a full member roster or that organization's own audit trail (see
`organization-security.md` "What platform staff can and cannot see").

## Security boundary (unchanged from Module 06)

Every mutation in this module follows the exact same shape every earlier
module established: **authenticate → resolve context → validate input
(Zod) → require permission → verify resource ownership → `withTenantContext()`
→ transaction → DB op.** No Server Action or Route Handler in this module
goes client → direct Prisma call → mutation. See `security.md` for the
project-wide statement of this rule and `rls.md` for why it's still
correct even though RLS is a second, independent layer underneath it.
