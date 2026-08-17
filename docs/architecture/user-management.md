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

## Administrative user management (Module 10)

Everything above is self-service. Module 10 adds the missing other half —
platform staff acting on ANOTHER person's global `User` record — in
`user-management-service.ts`, gated by the `users.read`/`users.create`/
`users.update`/`users.delete` permissions Module 05 reserved specifically
for this (`permissions.ts`'s own top comment: "Module 07 is expected to be
the first real caller" — off by a few module numbers, but this is that
caller). See `user-lifecycle.md`, `session-management.md`, and
`user-security.md` for the deep dives; this section is the map.

### The platform-wide user directory (`/admin/users`)

Cursor-paginated (`user-repository.ts:search()`), never offset — a
platform user base grows unbounded over the platform's lifetime, the
same "audit log/activity feed" reasoning `pagination.ts` already
documents. Search matches name OR email; filters by `status`/
`emailVerified`. Deliberately does NOT support arbitrary column sort
(name/email/last-login) — a real compound keyset cursor per sortable
column is more machinery than justified today, and the spec's own hard
requirement ("do not use offset pagination for large user lists") wins
over the sort-order wishlist when the two are in tension.

### The user-detail view (`/admin/users/[id]`)

One composed read (`getUserDetail()`), five panels:

- **Identity/lifecycle** — status, edit name, suspend/reactivate/
  deactivate. See `user-lifecycle.md` for the full state machine.
- **Organizations** — read-only membership summary, links out to
  `/organizations/{id}/members` for actual membership mutation. A
  deliberate simplification, not a gap: re-implementing per-org
  permission-gated membership actions a second time in a global context
  would duplicate `membership-service.ts`/`role-service.ts` for no real
  benefit.
- **Sessions** — see `session-management.md`.
- **Invitations** — cross-org history (`invitationRepository.listByEmail()`,
  Module 10's own addition), with REAL resend/revoke buttons wired
  directly to `invitation-service.ts`'s existing, independently
  re-authorized `resendInvitation()`/`revokeInvitation()` — a second UI
  entry point into the same chokepoint, never a second implementation.
- **Recent activity** — platform-scope `AuditEvent` rows only
  (`organizationId: NULL`) — see `user-security.md` "Activity scoping"
  for why every other organization's own membership/role-change events
  about this person are deliberately excluded here.

### Creating platform staff (`/admin/users/new`)

The one genuinely new creation capability: `createPlatformUser()`. The
existing invitation system (`invitation-service.ts`) structurally cannot
grant platform access — `createInvitation()` rejects any role with
`scope !== "ORGANIZATION"` — so before this module, the only way a human
became platform staff was `prisma/seed-rbac.ts`, a dev-only script.
`users.create` closes that gap: creates a bare `User` + a membership on
the one `isPlatform` organization with a caller-chosen PLATFORM-scope
system role (custom platform roles don't exist structurally —
`createCustomRole()` hardcodes `scope: "ORGANIZATION"` — so this is
re-validated, not assumed). Never accepts `organizationId`/
`isPlatformStaff` from the client — the platform organization is always
resolved server-side.

Credential handling reuses Module 04's existing password-reset
primitives verbatim: a random, unusable placeholder `UserCredential` is
created (so the account cannot authenticate at all), then a real
`PASSWORD_RESET` `AuthToken` is issued and emailed — the new person
consumes it through the exact same, completely unmodified
`resetPassword()` flow every other password reset already uses. Zero
changes to Module 04's own code.

### Real bugs found

Two real, pre-existing gaps found by actually running this module's own
Playwright suite against a production build, not by inspection:

1. **`UserSession.userAgent` was always `null`.** The column, repository,
   and service function all existed since Module 04 (that model's own
   schema comment even said "for the future session-management UI, not
   built in this module") — but the one real call site,
   `auth.ts`'s `jwt` callback, hardcoded `createUserSession(user.id,
   null)`. Module 10's session-management UI is the first real consumer
   of this field, and it was silently empty on every row. Fixed by
   capturing `request.headers.get("user-agent")` inside Auth.js's
   `authorize()` (the one callback that receives the real `Request`) and
   carrying it one hop to `jwt()` via a small, deliberately transient
   `User.userAgent` type augmentation (`types/next-auth.d.ts`) — never
   persisted to the JWT or `Session` itself.
2. **Empty-string `<select>` filters crashed the whole page.** Both
   `/admin/users` (this module) and `/admin/notifications` (Module 09,
   discovered as the same latent bug once this module's own testing
   found the pattern once) fed an unselected "Any status"/"Any channel"
   `<option value="">` straight into a `z.enum([...]).optional()` schema
   — Zod treats `""` as an invalid enum value, not an absent one, so
   submitting the filter form with nothing chosen 400'd the entire page.
   `audit/query.ts` had already solved this exact class of bug for its
   own date/string filters (`optionalFromQueryParam`); that helper is
   now promoted to `lib/validation/parse.ts` and reused by both fixed
   schemas, closing the gap in one place instead of three.
