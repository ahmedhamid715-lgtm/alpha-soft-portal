# Testing

Vitest, configured via `vite-tsconfig-paths` so `@/*` imports resolve the
same way they do in the app. Tests live under `tests/unit/`, mirroring
`src/`'s structure (e.g. `src/lib/utils/money.ts` → `tests/unit/lib/utils/money.test.ts`).

```sh
npm test          # run once
npm run test:watch
```

## What Module 01 tests

Platform infrastructure only — there's no business logic yet to test.
Coverage focuses on the pieces most likely to silently misbehave:

- **Configuration** (`src/config/environment.ts`) — boots with no
  optional variables set, accepts a valid `DATABASE_URL`, and throws a
  readable error for a malformed URL, an unsupported `LOG_LEVEL`, or a
  too-short `AUTH_SECRET`. Since validation runs at module-load time,
  these tests use `vi.resetModules()` + dynamic `import()` per case
  rather than a single static import.
- **Validation** (`parseOrThrow`) — valid input, invalid input, and that
  the thrown error is a `ValidationError` with field-level detail.
- **Errors** (`AppError` subclasses) — `toSafeJSON()` never includes a
  stack trace; `toAppError()` normalizes unknown thrown values to
  `InternalServerError`.
- **Money** — `toMinorUnits`/`fromMinorUnits` round-trip correctly,
  zero-decimal currencies (JPY) behave differently from two-decimal
  (USD), `addMoney` rejects mismatched currencies.
- **Date/time** — `formatInTimeZone` produces different output for
  different zones on the same UTC instant; `isValidTimeZone` rejects
  garbage input.
- **Pagination** — default/min/max clamping on the Zod schemas,
  `hasNextPage` calculated correctly with and without a `totalCount`.
- **Logging redaction** — a key matching the sensitive-key pattern is
  replaced regardless of nesting depth; non-sensitive keys pass through
  unchanged.
- **ID strategy** — `generateId()` produces valid, version-7 UUIDs.
- **Database health** (`checkDatabaseHealth`) — runs against whatever
  database state the test environment actually has, no Prisma mocking.
  In an environment with no `DATABASE_URL` (this one, currently), the
  real "unavailable" path is exercised and asserted to never leak
  connection details. Once a real test database exists, add a companion
  test for the "healthy" path rather than replacing this one.
- **Server/client boundary** (`tests/unit/security/`) — a static check
  that every module touching a secret, the database, or another
  server-only capability declares `import "server-only"`, and that the
  public-safe modules (`environment.public.ts`, `app-error.ts`)
  deliberately don't. This can't replace Next's own build-time
  enforcement, but it catches a missing import before that import would
  matter.

## Conventions for future modules

- One test file per source file, same relative path under `tests/unit/`.
- Test the public interface (what a caller imports), not private
  implementation details.
- A test that requires a real database, a real Anthropic API key, or any
  other live external dependency belongs in an integration suite, not
  here — Module 60 (Testing Platform) formalizes that split. Until then,
  keep `tests/unit/` fast and dependency-free.
