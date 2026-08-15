# Security Foundation

**This module provides baseline platform security, not complete
application security.** Authentication-specific hardening is Module 04's
job, authorization/RBAC-specific is Module 05's, AI-prompt-injection
defenses are Module 33/37's, tenant-isolation is Module 06/07's. Treat
everything below as "the floor every module builds on," not "the whole
picture."

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

`src/lib/platform/rate-limit.ts` defines the `RateLimiter` interface and
ships a no-op default — nothing in Module 01 needs real rate limiting yet
(no public API, no login form, no AI chat). The first module that adds a
rate-limit-sensitive surface should swap in a real backend (Upstash Redis
is the natural fit) without touching the interface.

## Cookies

No cookie-setting code exists yet — that starts with Module 04
(Authentication), which will set `httpOnly`, `secure` (in production),
and `sameSite: "lax"` (at minimum) on any session cookie. Documenting the
intended default here so Module 04 doesn't have to relitigate it.

## Database error safety

`translatePrismaError()` (see `database.md`) ensures a database failure
never leaks a constraint name, table name, or connection detail to a
client — this is as much a security concern (information disclosure) as
a UX one.
