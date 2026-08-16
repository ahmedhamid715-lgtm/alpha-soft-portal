# Invitations

Module 07. `admin invites → invitation created → recipient accepts →
membership created with the offered role`. Token handling mirrors Module
04's password-reset/email-verification flows exactly — the same
primitives (`lib/auth/tokens.ts`), not a parallel mechanism.

## Model

`Invitation` (`organization_invitations`): `organizationId`, `email`,
`roleId`, `invitedByUserId`, `tokenHash`, `status` (`PENDING` / `ACCEPTED`
/ `REVOKED` — no `EXPIRED` member; see "Expiry" below), `expiresAt`,
`acceptedAt`, `acceptedByUserId`, `revokedAt`.

## Token handling

`generateRawToken()`/`hashToken()` (SHA-256, hex digest) — reused from
Module 04, not reinvented. The raw token is generated, emailed, and never
persisted; only its hash lives in `tokenHash`. A database read alone (a
backup, a careless log line) can never yield a usable token.

## Expiry

Deliberately **not** a fourth `status` value. An invitation's real
"expired-ness" is always computed from `expiresAt < now()` at the moment
it's checked (`acceptInvitation()`, `getInvitationPreview()`, and the UI's
own `displayStatus()` helper) — a separately-tracked `EXPIRED` status would
drift the instant the clock ticks past `expiresAt` without anyone writing
to the row. The dev seed fixture for "an expired invitation" is exactly a
`PENDING` row with `expiresAt` set 24 hours in the past — never a fake
status.

## Creating an invitation (spec sections 11–15)

`createInvitation()` (`invitation-service.ts`) is the one chokepoint —
mirrors `role-service.ts`'s `assignRole()` on purpose (spec section 17:
"do not recreate role logic"):

1. **Permission gate**: `members.invite`, organization-scoped — only
   `owner`/`admin` hold it.
2. **Role scope/ownership validation** — identical checks `assignRole()`
   already uses: the offered role must be `ORGANIZATION`-scope (never
   `PLATFORM`) and, if custom, must belong to this exact organization.
   An inviter can never offer a role they couldn't assign directly.
3. **Duplicate/conflict checks**: an existing `PENDING` invitation for the
   same email, or an existing active membership, both reject with a clear
   error — backed by a real partial unique index
   (`organization_invitations_pending_email_key` on
   `(organization_id, email) WHERE status = 'PENDING'`) as defense in
   depth against a race between the pre-check and the insert, not just an
   application-level check.
4. **Rate limiting**: `invitationRateLimiter`, per-organization.

## Accepting an invitation (spec sections 12–16)

`acceptInvitation()` never trusts a client-supplied `organizationId`,
`userId`, or `roleId` — every one is re-derived from the invitation row the
token resolves to, or from Module 04's own session. Two identity paths:

- **Already authenticated**: the session's email must match the
  invitation's email exactly (normalized) — accepting while logged in as a
  *different* person than who was invited returns `email_mismatch`, not a
  membership for the wrong account. This is the specific IDOR spec section
  48 asks about.
- **Not authenticated, email has no existing account**: `name`/`password`
  are required; a real `User` + `UserCredential` are created using Module
  04's own `hashPassword()`, inside the same transaction as the
  membership — never a parallel signup mechanism.
- **Not authenticated, email already has an account**: `account_required`
  — the UI routes to `/login?callbackUrl=...`, preserving the invitation
  token, rather than silently failing or creating a second identity for
  the same email.

**Race safety (spec sections 44/45)**: `invitationRepository.
claimForAcceptance()` is an atomic, conditional `UPDATE ... WHERE status =
'PENDING'`, run inside the same transaction as the resulting membership
creation. Two concurrent accept requests for the same token can only ever
have one `UPDATE` match the row — Postgres's own row-level locking does
the real work, no application mutex needed. The loser sees
`already_used`, never a duplicate membership. Proven with a real
two-browser-tab Playwright test racing the same token, in addition to the
Vitest service-level race test.

**Invitation replay**: accepting the same link a second time after a
successful accept returns `already_used` — tested explicitly, not just
implied by the race test.

## Revoking and resending

Both `members.invite`-gated, organization-scoped. `resendInvitation()`
rotates the token and extends expiry — the old link stops working the
moment this succeeds (its hash no longer matches any row); it does not
reuse the same token with a new expiry.

## Data privacy (spec section 52)

`getInvitationPreview()` (powers the `/invitations/accept` page before the
recipient does anything) returns only `organizationName`, `roleName`,
`email` — never the invitation's own id, `tokenHash`, or who sent it. The
admin-facing invitations list (`/organizations/[id]/invitations`) never
shows a raw token either; only its lifecycle status.

## Dev-mode invitation inspection

`sendInvitationEmail()` (`lib/mail/mailer.ts`) logs in development rather
than emailing a real address — the same pattern Module 04 already
established for verification/reset emails. No test in this module's suite
emails a real user; the E2E tests that need a real acceptance flow write a
freshly-minted token's hash directly to the seeded invitation row,
standing in for "the email link the recipient actually clicked" without
needing to intercept a real inbox.

## Cross-tenant IDOR coverage

`revokeInvitation()`'s `organizationId` parameter is independently
re-verified by `requirePermission("members.invite", organizationId)` —
Org B's owner supplying Org A's real `invitationId` alongside Org A's
`organizationId` fails at that permission check, before ever touching the
invitation row (`invitation-service.test.ts`, "cross-tenant IDOR: an
owner cannot revoke another organization's invitation by forging
organizationId"). The equivalent UI-level guarantee — Org B's owner never
even *sees* Org A's invitations to attempt this through the UI at all — is
covered in the Playwright suite.
