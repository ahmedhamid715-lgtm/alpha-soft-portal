# Authentication & Identity (Module 04)

Enterprise identity for Alpha OS: credentials-based sign-in, real
server-side session revocation, password reset, email verification,
login protection, and role-aware post-login routing — the foundation
Module 05 (RBAC), Module 06 (Multi-Tenancy), and eventually MFA/SSO build
on. **Authentication only** — "who are you" — never authorization
("what can you do"), which stays a hard boundary Module 05 owns (see
"Authentication vs. authorization" below).

## Architecture

```
Browser
   ↓
Next.js (Server Actions, proxy.ts)
   ↓
Auth.js (Credentials provider, JWT session strategy)
   ↓
Identity/session layer (server/services/*, lib/auth/session-guard.ts)
   ↓
Prisma
   ↓
Supabase PostgreSQL (production) / local Postgres (dev, see database.md)
```

## Provider: Auth.js v5, no adapter

**Auth.js (`next-auth@5.0.0-beta.32`)**, per the spec's directive — worth
being explicit that this is still a beta release on npm (`next-auth`'s
`latest` tag still points at v4; v5 has been the actively-developed,
community-recommended path for a long time regardless). Pinned to an
exact version, not a floating `^5.0.0-beta`, so a beta-to-beta bump is a
deliberate decision, not an accidental one.

**No `PrismaAdapter`.** Auth.js's adapter exists to manage OAuth `Account`
linking and adapter-owned `Session`/`VerificationToken` tables — none of
which this module needs: there's no OAuth provider yet, and (see below)
the Credentials provider can't use the adapter's database session
strategy anyway. `authorize()` queries this app's own `userRepository`/
`credentialRepository` directly. Adding `PrismaAdapter` later, once an
OAuth provider needs real Account linking, is additive — nothing here
blocks it.

## Session strategy: JWT — by constraint, not preference

Auth.js throws `UnsupportedStrategy` if a Credentials provider is
configured without `session.strategy: "jwt"` — the database session
strategy simply isn't available here. JWT alone gives **no server-side
revocation** — a JWT stays valid by signature/expiry alone until it
expires, which directly conflicts with the spec's explicit requirements
(logout-everywhere, revoke-after-password-reset, admin revocation).

**The fix: this module's own `UserSession` table**, entirely separate
from Auth.js's own (unused) session concept:

1. On sign-in, `auth.ts`'s `jwt` callback calls `createUserSession()`,
   which mints a `UserSession` row (its own UUIDv7, an expiry, `null`
   `revokedAt`) and stores that row's `id` in the JWT (`token.sessionId`).
2. `getCurrentUser()`/`requireAuthenticatedUser()`
   (`lib/auth/session-guard.ts`) — the one authoritative "is this request
   actually authenticated" check every protected Server Component/Action/
   Route Handler calls — look that row up and check `revokedAt`/
   `expiresAt`/the user's `status`, not just the JWT's own claims.
3. Logout, "revoke everywhere," and password reset all just update that
   row (`revokedAt`, `revokedReason`) — the JWT cookie may still exist in
   the browser, but the authoritative check treats it as unauthenticated.

This costs one DB lookup per authoritative check — the same real cost a
database session strategy would have had anyway, achieved despite the
Credentials-provider constraint rather than by picking JWT "because it
was easier" (the spec's explicit concern).

### `proxy.ts` stays cheap on purpose

`proxy.ts` only checks whether `auth()` resolves a JWT at all (valid
signature, not expired) — it does **not** query `UserSession` on every
request. Two reasons: performance (a DB round trip on every request to a
protected-prefix path, most of which are about to make their own DB
calls anyway, is wasteful), and principle (spec section 20 — "never rely
solely on 'the user couldn't reach the page'"). The proxy is a UX
convenience; `requireAuthenticatedUser()` is the actual security
boundary, and is called independently by every protected surface.

### One config file, not the usual edge/Node split

Most Auth.js v5 guides split `auth.config.ts` (edge-safe, no Prisma) from
`auth.ts` (the full config, Node-only) so an edge-runtime proxy stays
free of Node-only code. **Next.js 16 changed `proxy.ts`'s default runtime
to Node.js** (see `platform-core.md`) — this app's proxy already runs in
the same runtime as everything else, so that split has no purpose here.
`src/auth.ts` is the one config, used directly everywhere.

## Database changes

Three new models (full reference: `prisma/schema.prisma`), none of them
Auth.js's own adapter schema:

| Model | Purpose |
|---|---|
| `UserCredential` | 1:1 with `User` — Argon2id password hash, kept in its own table rather than columns on `User` |
| `UserSession` | This module's session-tracking table (see above) — id, userId, userAgent, timestamps, `revokedAt`/`revokedReason` |
| `AuthToken` | One shape for both email-verification and password-reset tokens — `purpose` enum, SHA-256 `tokenHash` (never the raw token), `expiresAt`, `consumedAt` |

`Organization`/`User`/`OrganizationMembership` (Module 03) are
**unmodified** except one addition: `OrganizationMembership.role` now
recognizes `"support"` in `SYSTEM_MEMBERSHIP_ROLES`
(`membership-repository.ts`) alongside `owner`/`admin`/`member` — needed
for the ADMIN/SUPPORT/CUSTOMER destination routing below. Adding a
recognized value to that list is exactly the extensibility Module 03
built the string-not-enum column for; no migration required.

## Password storage

**Argon2id** (`argon2` npm package, native binding) — this project's
Node.js runtime has no edge-runtime constraint that would make it
impractical, so there's no reason to reach for bcrypt. The library's own
defaults (64 MiB memory, 3 iterations, 4-way parallelism, 32-byte output)
already match current OWASP guidance and are used unmodified. A hash is
never logged, never returned from any function outside
`lib/auth/password.ts`/`credential-repository.ts`, and never crosses into
a client component (`password.ts` is `"server-only"` — see "Security
issues found and fixed" for a real boundary violation this caught).

## Password policy

Length-based, not composition-based (spec section 13, current NIST SP
800-63B / OWASP guidance): 12–128 characters, no mandatory symbols/
numbers/uppercase, no trimming (`lib/auth/password-policy.ts`). Split
into its own client-safe file — no `"server-only"`, no `argon2` — from
`password.ts`'s actual hashing functions; see that file's comment and
"Security issues found and fixed" for why the split exists.

## Token storage (verification & reset)

Both email verification and password reset use the same `AuthToken`
shape: a cryptographically random 256-bit raw token
(`lib/auth/tokens.ts`, `crypto.randomBytes`) is generated, sent to the
user's email, and **never persisted** — only its SHA-256 hash is stored.
A database read alone (a backup, a compromised replica) can never yield a
usable token. Verification tokens live 24 hours; reset tokens live 1
hour (shorter — a reset token grants a real account takeover if leaked,
a verification token only confirms an email address).

## Enumeration protection

- **Login**: `verifyCredentials()` returns `null` — indistinguishably —
  for a nonexistent account, a wrong password, a suspended/inactive
  account, or a missing credential. It also runs a decoy `verifyPassword`
  call against a fixed dummy hash when the account doesn't exist, so a
  nonexistent-email attempt takes roughly the same wall-clock time as a
  wrong-password attempt against a real one.
- **Forgot password**: `requestPasswordReset()` resolves the same way
  (silently) whether or not the account exists; the UI always shows "If
  an account exists, we've sent instructions" — never "that email doesn't
  exist."
- **Verify/reset links**: distinguish `invalid`/`expired`/`already_used`
  freely — these aren't secrets whose existence needs hiding, they're
  one-time actions the user just clicked from their own email.

## Login protection

`InMemoryRateLimiter` (`lib/platform/rate-limit.ts`) — the first real
(non-no-op) implementation of Module 01's `RateLimiter` interface, not a
second parallel system. 10 attempts per 15-minute window, keyed by
`${action}:${normalizedEmail}` (not IP alone — a shared office/NAT IP
shouldn't lock out every employee over one person's typos). Applied to
login, forgot-password, and reset-password.

**In-memory, not Redis** — this project has no Redis/Upstash configured
anywhere; the known limitation (state resets on restart, doesn't
coordinate across multiple instances) is real and documented at the
class definition — swap it for a Redis-backed implementation behind the
same interface the moment horizontal scaling makes that necessary,
without touching any call site.

No permanent account lockout — a rate-limited account can try again once
the window resets; there's no path from "too many failed attempts" to
"this account is now disabled," which would itself be a denial-of-service
vector (an attacker locking out a legitimate user by deliberately failing
their login repeatedly).

## Account lifecycle

Reuses Module 03's `User.status` enum — no second lifecycle table:

| Status | Can sign in? | Set by |
|---|---|---|
| `INVITED` | No | Default on creation — no credential exists yet |
| `ACTIVE` | Yes | `recordLogin()` on first successful sign-in; also set on email verification |
| `SUSPENDED` | No | Not built in this module — an admin-facing "suspend user" action is a future module's job |
| `DEACTIVATED` | No | Same — not built here |

`verifyCredentials()` only allows `ACTIVE` accounts through — everything
else fails the same generic way as a wrong password (see "Enumeration
protection").

## Organization context

A user may belong to more than one organization (Module 03). This module
does **not** guess which one is "current": `getCurrentMembership()`
resolves the caller's membership in an explicitly-given organization, or
— if omitted — their *sole* membership if they have exactly one.
Zero or multiple memberships with no explicit `organizationId` resolves
to `null`. Module 06 (Multi-Tenancy) owns real organization-switching (a
cookie, a URL segment, a picker UI); this is the honest, minimal
foundation that doesn't paint that module into a corner — see
`tenancy-foundation.md` (Module 03) for the same principle applied there.

## Role-aware destination routing

One centralized function, `resolveDestination()` (`lib/auth/destination.ts`),
not `if (role === ...)` scattered across the app:

| Membership role | Destination |
|---|---|
| `owner`, `admin` | `/admin` |
| `support` | `/support` |
| `member`, or no resolvable membership | `/dashboard` (the safe default — never an internal destination) |

For a user with multiple memberships, the login action currently has no
single "current" role to resolve from (see "Organization context") — the
destination falls through to `/dashboard`. This is a genuine, documented
limitation of Module 04's scope, not a bug: resolving a truly ambiguous
multi-org login correctly is Module 06's job.

A `?callbackUrl=` (set by `proxy.ts` when an unauthenticated request hits
a protected path) takes priority over the role-resolved destination when
present and same-origin — validated to start with `/` and not `//`,
since accepting an absolute/external URL there would be an open-redirect
vulnerability, not a convenience.

## Protected routes

`/admin`, `/support`, `/dashboard` (spec section 34) — Module 04
establishes **authenticated vs. unauthenticated** only. There is no
role-based authorization gate on these routes yet (a `support`-role user
manually navigating to `/admin` would currently succeed) — that's Module
05's job. The three placeholder pages under `src/app/(protected)/` exist
solely to prove the authentication boundary and destination routing work
end to end; they are explicitly not real Admin/Support/Customer UI (spec
section 43) — Modules 09/32/20 build those.

## Email

`lib/mail/mailer.ts` — a `MailProvider` interface with a
`ConsoleMailProvider` default (logs, and in non-production also prints
the full email body including the verification/reset link to the
terminal running the app). No real provider is configured; swapping one
in later touches this one file, not every service that triggers an
email. `sendVerificationEmail`/`sendPasswordResetEmail` own the actual
subject/body copy so a later HTML-template upgrade is centralized too.

## Environment variables

Added to `.env.example`:

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | Yes (production) | Already reserved by Module 01; signs/encrypts the JWT. `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Production only, if behind a proxy/host you control | See below |

`AUTH_URL` is deliberately **not** added — Auth.js infers the host from
request headers, which is sufficient here.

### `AUTH_TRUST_HOST` — found by actually running the app

Auth.js refuses to trust the `Host` header in production
(`UntrustedHost` error) unless `AUTH_TRUST_HOST=true` is set — a real
security feature (prevents host-header injection affecting things like
reset-link generation), not a bug. This blocked local verification
against a production build (`npm run start`) until set — and will
genuinely be needed in real production too, since Alpha OS will deploy
behind some hosting platform's reverse proxy. Set it wherever the app
actually runs in production, alongside `AUTH_SECRET`.

## Session/device foundation

`UserSession.userAgent` is stored, truncated to 255 characters —
informational (a future "your active sessions" list), not a
fingerprinting mechanism. No IP address or geolocation is collected (spec
section 26 — "do not collect invasive fingerprinting data ... do not
store unnecessary IP/location information"). No session-management UI is
built in this module.

## Testing

| Tier | Location | Covers |
|---|---|---|
| Unit | `tests/unit/lib/auth/*`, `tests/unit/lib/platform/rate-limit.test.ts` | `resolveDestination` role mapping, token generation/hashing, password policy validation, `InMemoryRateLimiter` behavior — all pure logic, no database |
| Database integration | `tests/integration/db/{auth-service,session-service,password-reset-service,email-verification-service}.test.ts` | Real Argon2 hashing/verification against real rows; every `verifyCredentials` failure mode; session creation/revocation; full reset/verification token lifecycles (issue, consume, expire, reuse); enumeration-safety (mail only sent for a real account) |
| E2E | `tests/e2e/{auth,rate-limit,accessibility}.spec.ts` (Playwright, see `playwright.config.ts`) | Real browser against a real running app: login (all three role destinations), invalid credentials, callbackUrl preservation, protected-route redirect, logout + re-entry block, rate-limit throttling, axe-core across all four auth pages × both themes |

Password-reset and email-verification are deliberately **not** covered
end-to-end through the browser — the raw token (correctly) never appears
anywhere the browser/HTTP layer can see it once the app runs in
production mode (see "Token storage" and `mailer.ts`'s dev-only console
output). The database-integration tier exercises that path directly
against the real database instead, which is the right layer for it.

## Security review

Performed against the actual running application (a real local Postgres,
`brew install postgresql@17` — see `database.md` "Testing" — never the
project's Supabase instance), not just by inspection:

- **Password storage**: Argon2id, verified no plaintext/hash ever appears in a log line or API response.
- **Session cookies**: Auth.js's own defaults — `httpOnly`, `sameSite: lax`, `secure` in production. Not overridden.
- **Token generation/expiration/storage**: 256-bit random, SHA-256-hashed at rest, single-use enforced in application code, verified via real expired/reused-token tests (both automated and manual, against real database rows with `expiresAt` forced into the past).
- **Session revocation**: verified for real — logged out, then confirmed via direct database query that the `UserSession` row was actually marked `revoked_reason: "user_logout"`, and that the same account's password reset revoked every other live session.
- **Enumeration**: verified a suspended account and a nonexistent account produce byte-identical error text on the login form.
- **Rate limiting**: verified an 11th rapid attempt is throttled.
- **CSRF**: handled by Auth.js's own mechanisms (the Credentials provider's `signIn()` call goes through Auth.js's built-in CSRF token, not a hand-rolled endpoint).
- **Authorization boundary**: no client-supplied `userId`/`organizationId`/`role` is ever trusted — identity is always re-derived server-side from the session (`session-guard.ts`), never read from a request body/query param.
- **Server/client boundary**: verified by `npm run build` failing loudly when it wasn't respected — see "Security issues found and fixed."

## Security issues found and fixed

1. **A client component pulled `argon2` (and its native binding) into
   the browser bundle.** `reset-password-form.tsx` imported
   `PASSWORD_MIN_LENGTH` from what was then a single `password.ts` file
   that also contained `hashPassword`/`verifyPassword` (both
   `"server-only"`, both dependent on `argon2`). Next.js's build
   correctly refused to compile this (`'server-only' cannot be imported
   from a Client Component module`) — found by running `npm run build`,
   not by inspection. Fixed by splitting the client-safe policy constants
   (`password-policy.ts`) from the server-only hashing functions
   (`password.ts`).
2. **`npm run db:seed` (and `prisma migrate reset`'s auto-seed hook) has
   always thrown**, going back to Module 03 — `server-only`'s no-op
   export only resolves under Node's `react-server` module condition,
   which Next.js's bundler sets automatically but a bare `tsx`
   invocation never did. Never previously caught because Module 01–03
   had no live database to actually run the seed script against; caught
   here because the seed script needed extending (three dev accounts
   with real passwords) and running it for real surfaced the pre-existing
   bug. Fixed in both `package.json` and `prisma.config.ts`
   (`tsx --conditions=react-server`) — technically a Module 03 bug, fixed
   in Module 04 because this was the first time it was actually exercised.
3. **Every login was silently landing on the generic customer
   destination regardless of role.** The login action originally called
   `getCurrentUser()`/`getCurrentMembership()` (which read the session via
   `auth()`) immediately after `signIn()` succeeded, inside the same
   Server Action invocation. `signIn()` sets the session cookie on the
   *outgoing* response; a `cookies()`/`auth()` read within that same
   action execution still sees the *incoming* request's cookie-less
   state — the browser hadn't round-tripped the new cookie back yet.
   Found by actually logging in as each of the three seeded roles and
   watching all three land on `/dashboard`. Fixed by resolving the
   destination from the just-authenticated email directly (already known
   in the action's scope — `signIn` wouldn't have succeeded otherwise),
   never by re-reading the session within the same action.
4. **Two real WCAG AA color-contrast failures, both pre-existing Module
   02 tokens, not introduced by this module** — found running axe-core
   against the actual login page, not the `/design-system` showcase
   (which apparently never happened to render these exact token/surface
   combinations): `--link`'s dark-mode value (`--brand-accent`,
   `#bf43ff`) cleared 4.5:1 against the page background (5.0:1) but not
   the lighter `--card` surface most inline links actually render on
   (4.31:1); `--light-text-muted` (`#8a8394`) was only 3.64:1 against the
   light theme's white card surface. Both fixed at the token level in
   `globals.css` with small, hue-preserving darken/lighten adjustments
   (`#c34eff`, `#77717f`) that clear 4.5:1 against every surface they
   actually appear on, with real margin — re-verified against
   `/design-system` afterward to confirm no regression there.
5. **Every auth page failed `page-has-heading-one`** — `CardTitle`
   (Module 02) is deliberately a styled `<div>`, not a heading (a `Card`
   can appear anywhere in a page hierarchy and can't presume to own a
   heading level), and none of these four standalone pages use
   `PageHeader` (which would normally supply the real `<h1>`). Fixed by
   adding a visually-hidden `<h1>` per page alongside the existing
   `CardTitle` (now `aria-hidden` to avoid double-announcing the same
   text).
