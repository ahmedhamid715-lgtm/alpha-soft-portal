# User lifecycle

The `User.status` state machine (Module 10, extending Module 04's
original `UserStatus` enum — no new status value added; see
`data-modeling.md` "Deletion strategy" for why deletion was never on the
table). See `user-management.md` for the surrounding architecture and
`user-security.md` for the trust model each transition enforces.

## States

```
INVITED ──(first successful login)──> ACTIVE
ACTIVE ──(suspendUser)──> SUSPENDED ──(reactivateUser)──> ACTIVE
ACTIVE ──(deactivateUser)──> DEACTIVATED ──(reactivateUser)──> ACTIVE
SUSPENDED ──(deactivateUser)──> DEACTIVATED
```

`INVITED` → `ACTIVE` is Module 04's own transition
(`userRepository.recordLogin()`, called from `auth-service.ts`'s
`createUserSession()` on every successful sign-in) — unrelated to this
module's own three mutations, listed for completeness of the full state
diagram.

No `DELETED` state exists and never will for `User` — a `User` row is
permanent identity, `data-modeling.md`'s own established rule.
`DEACTIVATED` is this system's closest equivalent to "removed," and even
that is reversible.

## The two permission tiers

| Transition | Permission | Function |
|---|---|---|
| `ACTIVE → SUSPENDED` | `users.update` | `suspendUser()` |
| `SUSPENDED → ACTIVE` | `users.update` | `reactivateUser()` |
| `ACTIVE\|SUSPENDED → DEACTIVATED` | `users.delete` | `deactivateUser()` |
| `DEACTIVATED → ACTIVE` | `users.delete` | `reactivateUser()` |

`reactivateUser()` is one function whose REQUIRED permission depends on
the account's CURRENT state, checked after loading the target row, not
a single fixed permission on the function itself — reactivating from
`DEACTIVATED` requires the same privilege level (`users.delete`) that
put it there; reactivating from the lesser `SUSPENDED` state only needs
the lesser `users.update`. This is deliberate, not an oversight: a
`support_admin` (holds `users.read` only — see `roles.ts`) can never
reactivate a deactivated account even though a naive single-permission
design might have let `users.update` cover both, because `users.delete`
is a strictly more privileged permission than `users.update` in the
`PLATFORM_FULL` grant (both `platform_owner`/`platform_admin` hold all
of it; a hypothetical future role holding only `users.update` could
suspend/reactivate-from-suspension but never touch a deactivated
account) — proven in
`tests/integration/db/user-management-service.test.ts` ("reactivateUser()
from DEACTIVATED requires users.delete").

## Global status vs. membership status — never coupled

Worth stating plainly, since the two are easy to conflate (the same
confusion `user-management.md`'s own "Account status" section already
warns about for the self-service `/settings/account` page):

- `User.status` — this module's own concern. A suspended/deactivated
  user cannot authenticate AT ALL, in ANY organization.
- `OrganizationMembership.status` — Module 06/07's own concern,
  unchanged by this module. A user can be `ACTIVE` globally and
  `SUSPENDED` in one specific organization while remaining a full member
  of another.

`suspendUser()`/`reactivateUser()`/`deactivateUser()` touch `User.status`
alone — never any `OrganizationMembership` row. Proven directly:
`tests/integration/db/user-management-service.test.ts`'s "reactivateUser()
from SUSPENDED... never touches an independent membership suspension"
suspends a membership independently, reactivates the GLOBAL account, and
asserts the membership is still exactly as suspended as before.

## Immediate effect — two independent layers, not one

A status change takes effect on the very next request, through two
mechanisms that don't depend on each other:

1. **`User.status` itself.** `getCurrentUser()`
   (`lib/auth/session-guard.ts`) checks `user.status !== "ACTIVE"` on
   EVERY call, resolved fresh from the database — a suspended/
   deactivated user's next page load already fails before any session
   table is even consulted for that specific check.
2. **Every live `UserSession` row is explicitly revoked** (`reason:
   "admin_suspended"`/`"admin_deactivated"`, via the existing
   `sessionService.revokeAllSessions()`). Technically redundant with (1)
   for blocking future requests, but real defense-in-depth: it's what
   makes `/settings/sessions`'/`/admin/users/[id]`'s own session list
   immediately show zero active sessions rather than silently going
   stale, and it means "immediately effective" doesn't rest on a single
   check.

## Self-protection and last-owner protection

One shared gate (`assertMutableAccount()`), checked identically by
`suspendUser()`/`deactivateUser()` (never `reactivateUser()` — restoring
access is never the dangerous direction):

- **No self-suspension/self-deactivation.** A platform admin cannot lock
  themselves out through this surface — `target.id === callerId` is
  rejected outright (`ValidationError`), before anything else runs.
  Recovery, if genuinely needed, requires a different platform
  administrator.
- **The platform's last active `platform_owner` cannot be
  suspended/deactivated.** `isLastActivePlatformOwner()` — the
  platform-level analog of `role-service.ts`'s own `wouldRemoveLastOwner()`
  (Module 05/07's org-level equivalent), reusing the identical
  `membershipRepository.countActiveByRole()` primitive against the one
  `isPlatform` organization rather than a second implementation. The
  platform organization is a real, database-enforced singleton
  (`organizations_single_platform_org`, a unique index on `(true) WHERE
  is_platform`) — there is structurally only ever one to check.

Both proven under real Postgres in
`tests/integration/db/user-management-service.test.ts`.

## What was deliberately not built

- A `DELETED`/hard-delete state — see "States" above.
- Automatic re-suspension of memberships when the global account is
  suspended (or vice versa) — see "Global status vs. membership status."
- A configurable/extensible status enum — four states, matching what
  Module 04 already shipped; a fifth would need a real justified need,
  not speculative extensibility.
