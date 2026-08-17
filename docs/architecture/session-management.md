# Session management

`UserSession` visibility and revocation (Module 10) — the UI Module 04
explicitly deferred (`UserSession`'s own schema comment: "for the future
session-management UI, not built in this module"). See
`authentication.md` for why this table exists at all (JWT strategy gives
no server-side revocation on its own) and `user-security.md` for the
trust model this file's own mechanisms enforce.

## Two callers, one ownership-checked primitive

`session-service.ts` (Module 04) already had raw primitives
(`revokeSession()`, `revokeAllSessions()`, `listActiveSessions()`) —
every existing caller (`password-reset-service.ts`) had already
independently resolved who's allowed to call them before reaching in, so
none of the three check ownership themselves. Module 10 is the first
caller that exposes revocation to a session id chosen by a UI, which
needed an ownership check no previous caller needed to add. Rather than
duplicate that check at each new call site, one function was added to
the SAME file:

```ts
async revokeOwnSession(sessionId: string, ownerUserId: string, reason: string): Promise<void>
```

A `sessionId` that doesn't belong to `ownerUserId` throws `NotFoundError`
— never revokes a different person's session, never leaks whether the id
was forged/guessed vs. genuinely someone else's (the same
enumeration-avoidance discipline every other IDOR-sensitive lookup in
this codebase follows). This one function serves BOTH real callers:

- **Self-service** (`/settings/sessions`) — `ownerUserId` is always the
  caller's own id, resolved from `requireAuthenticatedPage()`, never a
  client-supplied parameter. Identity-gated, no permission check — the
  same "no role should ever need permission to manage their own X"
  precedent Module 09's notification preferences already established.
- **Admin** (`/admin/users/[id]`, `revokeUserSession()` in
  `user-management-service.ts`) — `ownerUserId` is the TARGET user's id;
  `users.update` gates the ability to act on someone else's account at
  all, and the ownership check inside `revokeOwnSession()` still
  independently verifies the specific session id actually belongs to
  that target (a forged `sessionId` copy-pasted from a different user's
  own page fails here too, not just at the permission gate).

## What's shown, and what never is

Only the columns `UserSession` actually has: a truncated `userAgent`
string, `createdAt`, `lastActiveAt`. There is no token, secret, or
credential field on this model at all — "never expose session secrets"
(spec section 11) holds structurally, not by convention, the same way
`MemberDetail` (Module 07) has no field to accidentally leak a
credential through.

The current session is marked "This device" (self-service view only —
the admin view has no equivalent concept, since the admin is never
looking at their own session list) by comparing each row's id against
`requireAuthenticatedPage()`'s own `sessionId`, and is the one row with
no "Sign out"/"Revoke" button — a user can always end every *other*
session without a risk of accidentally locking themselves out of the
page they're using to do it.

## A real bug this module found: `userAgent` was always `null`

`createUserSession(userId, userAgent)` (`auth-service.ts`) accepted and
stored a `userAgent` parameter since Module 04 — but its one real call
site, `auth.ts`'s `jwt` callback, hardcoded `null`, unconditionally.
Nothing before this module ever rendered the field, so the gap was
invisible until Module 10's own session list became the first real
consumer and showed "Unknown device" for every row, including a session
created moments earlier in the same browser.

Auth.js v5's `jwt` callback has no access to the original `Request` —
only `authorize()` (the Credentials provider's own callback) receives
one, as its second parameter. Fixed by capturing
`request.headers.get("user-agent")` there and carrying it exactly one
hop to `jwt()` via the `user` object `authorize()` returns (Auth.js's
own mechanism for passing data from `authorize()` into `jwt()`) — a
small, explicitly-transient `User.userAgent` type augmentation in
`types/next-auth.d.ts`, never added to the `JWT` or `Session` interfaces
themselves, so it never persists anywhere beyond that one hop. Verified
end-to-end with a real Playwright login against a production build —
`/settings/sessions` now shows the real browser's user-agent string on
the current-device row.

## Revoke-all vs. revoke-one

- **`revokeOtherSessionsAction()`** (self-service "Sign out other
  devices") — `sessionService.revokeAllSessions(userId, "user_revoked_all",
  exceptSessionId)`, sparing the session making the request. A user can
  never accidentally sign themselves out with this button.
- **`suspendUser()`/`deactivateUser()`** (admin lifecycle mutations) —
  `revokeAllSessions(userId, reason)` with NO exception — every session
  is revoked, including any the admin might coincidentally share (they
  don't, structurally: an admin acting on someone else's account is
  never that account's own session).
- **Individual revoke** (both self-service and admin) —
  `revokeOwnSession()`, one row at a time, as described above.

## Rate limiting

Not added. Every mutation here is either identity-gated (self-service —
a user can only ever affect their own, already-small set of sessions) or
`users.update`-gated (admin — the same trust tier as `/admin/roles`,
which has no rate limiting either). Evaluated and deliberately not built,
the same "don't add infrastructure a real threat model doesn't justify"
discipline `notification-security.md` applies to its own scope.

## What was deliberately not built

- Device fingerprinting/geolocation beyond the raw, truncated
  `userAgent` string — `UserSession`'s own schema comment already says
  this: "informational only, not a fingerprinting mechanism."
- Push notifications/email alerts on new-session creation — a plausible
  future security feature, not built speculatively.
- A "trust this device" / remembered-device concept — every session is
  treated identically regardless of age or prior use.
