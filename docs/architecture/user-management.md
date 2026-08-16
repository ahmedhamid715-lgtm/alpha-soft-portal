# User Management

Module 07. Self-service identity management — a person managing their own
global `User` record — as distinct from organization admin actions on
*other* people (see `organization-management.md`) and from authentication
itself (Module 04, `authentication.md`).

## Global identity vs. membership

A `User` row is a single, global identity — email, name, avatar, timezone,
locale, account status. It has no `organizationId`, `role`, or
`membershipId` field, and never will: those live on `OrganizationMembership`
(Module 04/06). One person with memberships in three organizations still has
exactly one `User` row; their role in each organization is tracked
independently on each membership. This structural separation is what makes
"my profile" and "this org's member list" two genuinely different concerns,
not two views of the same data.

## Self-service profile (`/profile`)

`user-profile-service.ts`'s `updateOwnProfile()` is the only way a user
changes their own presentation fields: `name`, `avatarUrl`, `timezone`,
`locale`. It deliberately cannot touch:

- **`email`** — changing it would need re-verification, which doesn't exist
  yet (see "What self-service cannot do" below).
- **`status`, `emailVerifiedAt`** — Module 04's authentication identity.
- Any `UserCredential`/`UserSession` row — password changes go through
  Module 04's existing forgot-password flow (`/forgot-password`), not this
  service.
- Anything membership/role-related — there is no field to touch even by
  accident; `updateProfileSchema` has no `organizationId` parameter.

The UI (`/profile`) is a single form, reachable from every protected page's
header nav, rendered inside the same minimal `(protected)/layout.tsx` chrome
every other Module 07 page uses (see `project-structure.md` — Module 07
deliberately doesn't wire up `AppShell`/`Sidebar`; that's reserved for the
real Admin/Support/Customer experiences).

## Account status (`/settings/account`)

Three independent statuses are easy to conflate; this page shows all three
side by side rather than collapsing them into one badge:

| Status | Scope | Owner | Where it's checked |
|---|---|---|---|
| `User.status` | Global account | Module 04 | `getCurrentUser()` — an `INACTIVE`/`SUSPENDED` user can't authenticate at all |
| `OrganizationMembership.status` | One membership | Module 06/07 | `resolveOrganizationContext()` — a `SUSPENDED` membership resolves zero permissions in that org, but the user can still sign in and act in *other* orgs |
| `Organization.status` | One organization | Module 06/07 | Same resolver — a non-`ACTIVE` organization zeroes permissions for *every* member, regardless of their own membership status |

None of the three imply the others. A perfectly `ACTIVE` user can be
`SUSPENDED` in one organization and a full member of another at the same
time — this is exactly what the `multiorg@alpha-os.test` fixture (admin in
Acme Corp, viewer in Beta Industries) and the suspended/archived
organization fixtures exist to prove, in both the Vitest and Playwright
suites.

## Multi-org experience

Switching which organization a session acts within is entirely Module 06's
`switchOrganizationAction`/`selectOrganization()` — Module 07 never
reimplements it, only links to `/organizations` (the switcher UI, unchanged
from Module 06 apart from an added "Create organization" entry point for
platform staff — see `organization-management.md` "Organization creation").
A stale or forged organization-id cookie is re-validated independently on
every request by `resolveOrganizationContext()`'s own real membership
lookup; the switcher UI is convenience, not the enforcement point.

## What self-service profile updates cannot do

Worth stating explicitly, since it's the boundary this whole file exists to
protect:

- Cannot change email (no re-verification flow exists yet — a real gap,
  intentionally not built in Module 07; see "Explicit scope exclusions" in
  the Module 07 completion report).
- Cannot change password (Module 04's `/forgot-password` flow is the only
  path).
- Cannot touch any organization's data, any membership, or any role.
- Cannot see or affect another user's account at all — there is no "admin
  edits a user's global profile" surface in this module (organization
  admins act on *memberships*, via `organization-management.md`, never
  directly on another person's `User` row).
