# Security Foundation

**This module provides baseline platform security, not complete
application security.** Authentication-specific hardening is Module 04's
job (see `authentication.md` for its own dedicated security review),
authorization/RBAC-specific is Module 05's (see `authorization.md`'s own
"Security review" — privilege escalation, cross-tenant access, IDOR,
role/owner deletion safety), AI-prompt-injection defenses are Module
33/37's, deeper tenant-isolation (RLS, defense in depth) is Module 06's.
Treat everything below as "the floor every module builds on," not "the
whole picture."

## Authorization (Module 05)

Client-supplied `userId`/`organizationId`/`role`/`permission` values are
never trusted for an authorization decision — every check re-derives
identity and permissions server-side from Module 04's session plus a
database read (`src/lib/authorization/context.ts`). See
`authorization.md` for the full engine and `rbac.md` for the data model.
Two genuinely new secrets-adjacent concerns Module 05 introduces beyond
Module 04's: a `Role`'s permission grants must never be readable/writable
by anyone who hasn't independently authorized for `roles.read`/
`roles.update` (enforced by `role-service.ts`, not left to the UI), and a
system role's definition must never be mutable at runtime regardless of
the caller's permission level (see `rbac.md` "System roles vs. custom
roles").

## Multi-tenancy & Row-Level Security (Module 06)

Tenant isolation is enforced twice, independently: Module 05's
application-layer authorization (the primary business-logic gate) and
PostgreSQL Row-Level Security underneath it (the database-level backstop
for when application code has a bug — a forgotten `WHERE` clause, a raw
query from a future internal tool). See `multi-tenancy.md` and `rls.md`
for the full design. The short version: `DATABASE_URL`'s role (a
superuser locally and on Supabase's default connection) unconditionally
bypasses RLS regardless of policy, so a **second, restricted,
non-superuser role** (`APP_DATABASE_URL`) is what RLS actually protects
against. Every tenant-scoped mutation goes through `withTenantContext()`
(`lib/tenancy/context.ts`), which trusts only an already-verified
`AuthorizationContext` from Module 05 — never a client-supplied
organization id, and never a value RLS itself decided. A real
vulnerability this module's own testing found and fixed: `Organization`
lifecycle status (`SUSPENDED`/`ARCHIVED`) was never checked by
`resolveOrganizationContext()`, only membership status — see
`multi-tenancy.md`'s "Organization context" section.

## Server/client boundary enforcement

`server-only` and `client-only` (tiny, zero-dependency packages) mark
modules that must never cross into the wrong bundle. `src/config/environment.ts`,
`src/lib/db/*`, and every file that could leak a secret imports
`"server-only"` at the top — if such a module is ever imported (even
transitively) from a client component, the build fails loudly instead of
shipping a secret to the browser. When adding a new server-only module,
add the import; don't rely on "I'll remember not to import this from a
client component."

## Secrets

- Never in `NEXT_PUBLIC_*` variables (see `configuration.md`).
- Never committed — `.gitignore` excludes `.env*` except `.env.example`
  (which contains no real values, only documentation).
- `npm`'s script-allowlist feature (`allowScripts` in `package.json`)
  means a fresh `npm install` will *not* silently execute arbitrary
  postinstall scripts from new dependencies — new packages with install
  scripts require an explicit `npm approve-scripts <pkg>` before they'll
  run. Don't blanket-approve; check what a script does before approving
  it (this project has approved `prisma`, `@prisma/engines`, `esbuild`,
  `unrs-resolver`, and `fsevents` — all legitimate build-tool
  postinstall/preinstall steps).

## HTTP security headers

Set globally via `next.config.ts`'s `headers()` function (not a
`proxy.ts`, since Next's own guidance is to avoid Proxy/Middleware unless
there's no other option — see `platform-core.md`):

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
`Permissions-Policy`, `X-DNS-Prefetch-Control: on`.

**No `Content-Security-Policy` yet — deliberately.** A real CSP needs to
enumerate every script/style/font source the app will ever load
(Anthropic streaming responses, GHL embeds, Google Business Profile
widgets, Google Maps, ...), which isn't knowable in Module 01. Shipping
an overly permissive placeholder CSP would give false confidence without
real protection; better to add a correct, specific one once the
integrations that need it exist.

## Input validation

Every trust boundary — API request body, query params, form submission,
webhook payload, external config — goes through a Zod schema and
`parseOrThrow()` (`src/lib/validation/parse.ts`), which throws a
`ValidationError` with a field-level breakdown on failure. Never trust
client input directly.

## Rate limiting

`src/lib/platform/rate-limit.ts` defines the `RateLimiter` interface;
`rateLimiter` (no-op) is still the default for routes with no
rate-limit-sensitive surface. Module 04 added the first real
implementation, `InMemoryRateLimiter`/`authRateLimiter`, applied to
login/forgot-password/reset-password — see `authentication.md` "Login
protection." Still no Redis/Upstash configured anywhere; swap the
implementation behind the same interface without touching call sites the
moment horizontal scaling makes in-memory state insufficient.

## Cookies

Module 04 (Authentication) added the first cookie-setting code — Auth.js's
own session cookie, using its defaults (`httpOnly`, `sameSite: "lax"`,
`secure` in production). Not overridden or hand-rolled.

## Data sensitivity

`User.email` and `User.name` are PII — logged only as IDs
(`logger.info("...", { organizationId, userId: ... })`, never
`{ email }`), never included in an error's `toSafeJSON()` output, and
excluded from `translatePrismaError()`'s constraint-name mapping (a
unique-email violation returns "A record with this value already
exists," not the email itself — see `errors.ts`).

**One narrow, deliberate exception**: `lib/mail/mailer.ts` logs the
recipient address (`to: message.to`) on every send attempt. Mail
delivery logging without the recipient is close to useless for
debugging ("did this actually get sent to the right person?"), and
logging it here isn't an incremental disclosure — the system is, by
definition, already sending a real email to that exact address. This is
different from logging it in an error path or API response, which could
reach a broader audience than "this system's own operational logs."

Module 04 (Authentication) added real secrets: password hashes
(Argon2id, `UserCredential.passwordHash`) and single-use tokens (SHA-256
hashed at rest, `AuthToken.tokenHash` — the raw value is never
persisted). Neither is ever logged, returned from an API response, or
crosses into a client component — see `authentication.md` "Password
storage," "Token storage," and "Security issues found and fixed" for a
real client-bundle boundary violation this caught.

## Database error safety

`translatePrismaError()` (see `database.md`) ensures a database failure
never leaks a constraint name, table name, or connection detail to a
client — this is as much a security concern (information disclosure) as
a UX one.
