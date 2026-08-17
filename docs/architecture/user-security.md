# User management security & trust model

The honest accounting of what Module 10 guarantees and how each is
proven — same discipline `audit-security.md`/`notification-security.md`
already established: state it plainly, prove the provable claims with
real tests against real Postgres, and don't claim more than what's
actually enforced.

## Trust boundaries — never client-supplied

Every one of these is always server-resolved in
`user-management-service.ts`, never accepted from request input:

- **The platform organization** — always
  `organizationRepository.findPlatformOrganization()`, never a client
  `organizationId`. Structurally impossible to point `createPlatformUser()`
  at a different organization — there is no such parameter.
- **`isPlatformStaff`/role scope** — `createPlatformUser()` independently
  re-validates the chosen role is `scope === "PLATFORM"` AND `isSystem`,
  regardless of what a client believes it selected from the dropdown.
- **The acting caller's identity** — every mutation resolves it via
  `requirePermission()`/`getCurrentUser()`, never a request parameter;
  `assertMutableAccount()`'s self-protection check would be trivially
  bypassable otherwise.
- **Session ownership** — `revokeOwnSession()`'s `ownerUserId` comes from
  either the caller's own resolved identity (self-service) or the
  already-permission-checked target user id (admin) — never trusted from
  the `sessionId` alone.

## RLS — deliberately does not apply here, and why that's correct

`User`/`UserSession`/`UserCredential` have **no RLS policy** — this is
not a gap Module 10 introduced; it's Module 06's own established
classification (`rls.md`'s "Tables deliberately without RLS": global
identity data, not tenant-owned). There is no `organizationId` column on
any of these three tables to scope a policy against in the first place.
Tenant isolation for Module 10's own mutations is enforced by:

1. **PLATFORM-scope permission checks** (`requirePermission("users.*")`)
   — the real authorization boundary for every function in
   `user-management-service.ts`.
2. **Explicit ownership checks** where a permission alone isn't the
   right question — `revokeOwnSession()`'s ownership check, and
   `assertMutableAccount()`'s self/last-owner checks.

The one place this module DOES touch an RLS-protected table is
`OrganizationMembership` (creating a platform membership in
`createPlatformUser()`, reading membership rows in `getUserDetail()`) —
those calls go through `withTenantContext()` exactly like every other
membership-touching call in this codebase (Module 06/07's own
established pattern), reused unchanged.

## IDOR — proven, not just designed

Two structurally different IDOR surfaces, both covered:

1. **Cross-user session revocation.** `revokeOwnSession()`'s ownership
   check — a `sessionId` for someone else's device throws `NotFoundError`,
   never revokes it. Proven in
   `tests/integration/db/user-management-service.test.ts` ("IDOR-safe —
   a sessionId belonging to a DIFFERENT user throws NotFoundError").
2. **Cross-user profile/lifecycle mutation.** Every mutation
   (`updateUserProfile`/`suspendUser`/`reactivateUser`/`deactivateUser`/
   `revokeUserSession`) resolves the target from a server-validated
   `userId`, loads the real row, and 404s (`NotFoundError`) if it doesn't
   exist — a forged/nonexistent id is indistinguishable from "not
   found," never a 403 that would confirm existence (spec's own
   enumeration-avoidance discipline, held throughout this codebase).

## Activity scoping — the platform-vs-organization leak this module avoids

`getUserDetail()`'s "recent activity" panel deliberately shows ONLY
platform-scope `AuditEvent` rows (`organizationId: NULL` — login/logout/
profile-updated/session-revoked/`user.*`), never an aggregated feed of
every organization this person belongs to. This is a real, considered
decision, not an oversight: `audit-security.md`/`audit-system.md`
already establish that `audit.readPlatform` must NEVER substitute for a
specific customer organization's own audit trail (`audit.read`,
independently permission-gated per organization). A platform admin
holding `users.read` does not necessarily hold `audit.read` in every
organization this person happens to belong to — showing that
organization's own membership/role-change events here, unconditionally,
would be exactly the leak those two docs already forbid for the audit
module's own surfaces. An admin who needs THAT organization's own
activity for this person follows the membership panel's own link to
`/organizations/{id}/audit`, where the real, independently-checked
`audit.read` gate applies. Proven directly in
`tests/integration/db/user-management-service.test.ts` — a platform-scope
event about the target appears in `recentActivity`; an org-scoped one
about the same target does not.

## Audit integration

Five new catalog actions (`user.created`, `user.updated`, `user.suspended`,
`user.reactivated`, `user.deactivated`), `ADMINISTRATION` category,
reusing Module 08's `audit.recordSuccess()` verbatim — no second audit
system. Session revocation reuses the EXISTING `auth.session.revoked`
action (already generic: "one or more sessions were revoked") rather
than adding a fourth near-duplicate action key, distinguished by a
`reason` metadata field (`admin_suspended`/`admin_deactivated`/
`admin_revoked`/`user_revoked_session`/`user_revoked_all`) — the same
pattern `password-reset-service.ts` already established for its own
`reason: "password_reset"`.

Never audited: plain reads (`listUsers`/`getUserDetail`) — the same "no
audit events for meaningless read access" discipline every other module
here applies; only mutations generate an event.

## Provider/secret leakage

Not applicable to this module directly — `createPlatformUser()`'s
welcome email reuses `sendWelcomeEmail()` (`mailer.ts`), which goes
through the SAME `emailProvider`/error-sanitization discipline
`notification-security.md` already documents in full; nothing new was
introduced here.

## Rate limiting — evaluated, not built

Every mutation is `users.*`-permission-gated (platform staff only) or
identity-gated on the caller's own resources (self-service sessions).
Neither surface is reachable by an unauthenticated or low-trust caller,
unlike the invitation system (`invitationRateLimiter`, reachable by any
org admin against any email address) or the authentication surface
(`authRateLimiter`, reachable by anyone). Evaluated against the same
criteria those two used and found not to meet the bar — see
`session-management.md`'s own identical note.

## The 30 adversarial questions (spec section 23)

Answered, and where meaningfully testable, proven with a real test —
not merely asserted:

1. Can a customer view another customer's user? — No `users.read`
   (PLATFORM). Proven: `notifications.spec.ts`-style denial test in
   `user-management.spec.ts` ("a non-platform-staff user is denied
   /admin/users").
2. Can a customer modify another user's role? — Role assignment stays
   Module 05/07's `assignRole()`, unchanged; `users.*` grants nothing
   role-related.
3. Can an organization admin modify a platform admin? — Organization
   permissions (`members.update`) are organization-scoped; they cannot
   touch a `User` row or a platform-org membership at all.
4. Can support staff accidentally gain organization-owner privileges? —
   No code path grants a role; `createPlatformUser()` only ever offers
   PLATFORM-scope system roles, structurally rejecting ORGANIZATION
   scope. Proven in the integration suite.
5–9. Can `organizationId`/`userId`/`roleId`/`membershipId`/`sessionId` be
   forged? — Every one is re-resolved/re-validated server-side; forged
   ids either 404 or fail role-scope validation. Proven throughout the
   integration suite.
10. Can a suspended user still access protected resources? — No;
    `getCurrentUser()` checks `status === "ACTIVE"` on every request,
    plus every session is explicitly revoked. See `user-lifecycle.md`
    "Immediate effect."
11. Can a removed member still access the organization? — Unchanged,
    Module 07's own guarantee; this module doesn't touch it.
12. Can an archived organization still grant permissions? — Unchanged,
    Module 06's own guarantee.
13. Can the last owner be removed? — Org-level: Module 05/07's
    unchanged `wouldRemoveLastOwner()`. Platform-level: this module's own
    `isLastActivePlatformOwner()`, proven in the integration suite.
14. Can two users become owner through a race? — Unchanged from Module
    07 (`SELECT ... FOR UPDATE` in `ownership-transfer-service.ts`); this
    module introduces no new ownership-transfer path.
15–17. Self-escalation / creating a platform role / hidden-field
   manipulation — `createPlatformUser()`'s role is independently
   re-validated server-side regardless of what a form submits; no
   endpoint accepts a raw permission list.
18. Can direct Server Action invocation bypass the UI? — Every action in
    `admin/users/actions.ts` calls straight into the same permission-
    checked service function the UI does; there is no separate, less-
    checked path.
19. Can audit actor identity be forged? — `audit.recordSuccess()`
    resolves the actor server-side (Module 08's own guarantee),
    unchanged.
20. Can tenant RLS be bypassed? — See "RLS" above; not applicable to
    `User`/`UserSession` (no RLS exists there by design), and the one
    RLS-protected table this module touches (`OrganizationMembership`)
    goes through the unchanged `withTenantContext()` path.
21–23. Invitation reuse/expiry/double-accept — Unchanged, Module 07's
    own `claimForAcceptance()` atomic-UPDATE race guarantee; this module
    only adds a read-only cross-org LIST plus reuse of the existing
    resend/revoke functions.
24. Can a revoked session remain usable? — No; `requireAuthenticatedUser()`
    checks `revokedAt` on every request (Module 04's own guarantee,
    unchanged).
25. Can a deactivated account authenticate? — No; same `status !==
    "ACTIVE"` check as suspended.
26. Can role changes leave stale permissions? — `authorize()` re-resolves
    permissions fresh, per request, from the database — never cached;
    unchanged from Module 05.
27. Can notification events leak another tenant's information? —
    Module 10 doesn't add any new notification integration (evaluated;
    no lifecycle transition here was judged to genuinely need one beyond
    what already exists — see "What was deliberately not built" below).
28. Can user search leak cross-tenant users? — Not applicable in the
    cross-tenant sense — `listUsers()` is deliberately platform-wide by
    design (spec section 1's own instruction), gated by `users.read`
    (PLATFORM); there is no "tenant" to leak across at this scope.
29. Can deactivated users disappear from required audit history? — No;
    deactivation is a `status` flip only, the row and every `AuditEvent`
    referencing it are unchanged. Proven: "deactivateUser() ... is a
    status flip, never a row deletion."
30. Can platform operations accidentally expose customer data? — This is
    exactly what "Activity scoping" above exists to prevent, and is the
    one adversarial question this module's own design most directly
    targets.

## What was deliberately not built

- Notification integration for lifecycle events (suspend/reactivate/
  deactivate) — evaluated against Module 09's own mandatory-vs-optional
  policy model and judged not clearly justified yet: unlike membership
  suspension (which Module 09 already wires — the person affected still
  has a working account to receive the notification in), a DEACTIVATED
  account cannot sign in to see an in-app notification, and email would
  need a dedicated category/template decision this module chose not to
  make speculatively. A real, documented gap, not silently assumed.
- Rate limiting — see "Rate limiting" above.
- A `sessions.*` permission — session revocation reuses `users.update`
  rather than a new permission key; evaluated and judged not to meet the
  bar for a dedicated permission the way `ownership.transfer` did.
