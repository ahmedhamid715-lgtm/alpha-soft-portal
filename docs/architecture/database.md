# Database Architecture (infrastructure)

Module 01 wired Prisma + PostgreSQL end-to-end with no business entities.
**Module 03 adds the first real models** — `Organization`, `User`,
`OrganizationMembership` — following the conventions below. See
`database-schema.md` for the full schema reference and ERD,
`data-modeling.md` for the naming/ID/timestamp/deletion/JSON/indexing
conventions those models follow, `migrations.md` for how schema changes
ship, and `tenancy-foundation.md` for the multi-tenancy model this
establishes the foundation for.

## Prisma 7's connection model (this will surprise anyone who's used Prisma 5/6)

Prisma ORM 7 moved connection configuration **out of `schema.prisma`**
and into a separate `prisma.config.ts` at the project root. The old
`datasource db { url = env("DATABASE_URL") }` pattern doesn't apply
here — `schema.prisma`'s datasource block only declares the provider:

```prisma
datasource db {
  provider = "postgresql"
}
```

`prisma.config.ts` supplies the actual URL, and — deliberately — does
**not** use `prisma/config`'s `env()` helper, because that helper throws
immediately if the variable is unset, which would break `prisma generate`
(and therefore `npm install`, since `postinstall` runs it) on a fresh
checkout with no database configured yet:

```ts
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:.../placeholder";
```

`prisma generate` never connects to a database, so the placeholder is
enough for it to succeed unconditionally. `prisma migrate dev`,
`prisma studio`, and any real query will fail — correctly — until a real
`DATABASE_URL` is set.

Prisma 7 also removed the separate `directUrl`/`DIRECT_DATABASE_URL`
concept — driver adapters (below) handle migrations over the same
connection automatically, so there's only one URL to configure.

## Driver adapters, not the old implicit connection

The default generator in Prisma 7 is `prisma-client` (not the old
`prisma-client-js`), and it requires an explicit `output` path — ours is
`src/generated/prisma` (git-ignored, regenerated via `npm run db:generate`
or automatically on `npm install`). At runtime, the generated client no
longer reads `DATABASE_URL` implicitly; it requires an explicit **driver
adapter**:

```ts
// src/lib/db/client.ts
const adapter = new PrismaPg({ connectionString: serverEnv.DATABASE_URL ?? FALLBACK });
export const db = new PrismaClient({ adapter });
```

This is why `@prisma/adapter-pg` is a dependency. Always import the
singleton `db` from `@/lib/db`, never construct your own `PrismaClient`
— the singleton is hot-reload-safe in development (cached on
`globalThis`) and guarded so importing it never crashes module evaluation
even without a configured database.

## Conventions every model follows

Applied by `Organization`/`User`/`OrganizationMembership` today; every
future model follows the same rules. Full reasoning (naming, JSON
strategy, indexing, constraints, cascade behavior) is in
`data-modeling.md` — this is the quick-reference version.

- **IDs: UUIDv7**, generated in application code via `generateId()`
  (`src/lib/utils/id.ts`), not database-generated auto-increment or plain
  UUIDv4. Time-ordered for index locality, globally unique without a
  central sequence, safe to expose in URLs. See that file's comment for
  the full reasoning.
- **Timestamps: UTC, timezone-aware column type.** Every `DateTime` field
  in a future model must use `@db.Timestamptz(3)`, never bare
  `timestamp`. Convert to a user/org timezone only at the presentation
  boundary via `formatInTimeZone()` (`src/lib/utils/datetime.ts`) — never
  in a repository, service, or API response.
- **Money: integer minor units**, never `Float`. A future `Invoice.amount`
  column is an `Int` (or `BigInt` for very large sums) holding cents, not
  a decimal dollar amount. See `src/lib/utils/money.ts`.
- **Soft-delete vs. archive vs. hard-delete**: decided per entity
  category, not applied uniformly. See `src/types/lifecycle.ts` for the
  full policy (`Softdeletable` for user-deletable records like customers/
  projects/documents; `Archivable` for records whose historical value is
  the point, like invoices and closed deals — never hard- or soft-delete
  financial records; hard delete reserved for genuinely disposable data
  like expired sessions).
- **Error translation**: any Prisma error thrown from a repository should
  go through `translatePrismaError()` (`src/lib/db/errors.ts`) — it maps
  `P2002` (unique constraint) to `ConflictError`, `P2025` (not found) to
  `NotFoundError`, everything else to a generic `DatabaseError` that never
  leaks SQL or constraint names to a client.
- **Transactions**: use `withTransaction()` (`src/lib/db/transaction.ts`)
  for any multi-write operation that must be atomic — it applies the same
  error translation and logging as single queries.

## Migrations

- Local development: `npm run db:migrate` (`prisma migrate dev`).
- CI/production: `npm run db:deploy` (`prisma migrate deploy` — applies
  pending migrations without generating new ones or prompting).
- Reset to a known state: `npx prisma migrate reset` — drops and
  re-migrates the dev database, then automatically re-runs
  `prisma/seed.ts` (configured via `migrations.seed` in
  `prisma.config.ts`). This is the supported reset path — don't hand-roll
  a "delete everything" script.

**Prisma Migrate is the schema source of truth, not the Supabase CLI.**
The `supabase` CLI (installed as a dev dependency, `supabase/config.toml`
from `npx supabase init`) is present for local dev stack / project
linking / Studio access — deliberately **not** for `supabase migration
new` or `supabase db push`. Running schema changes through both tools
would produce two competing migration histories for the same database.
If that division ever needs to change, update this section first.

## Seeding

`prisma/seed.ts` is development-only (refuses to run when
`NODE_ENV=production`) and creates one development organization with one
owner membership, via `createOrganizationWithOwner`
(`server/services/organization-service.ts`) — the same service a real
"create organization" flow will call — rather than raw `db.organization.create`
calls, so the seed script doubles as a smoke test that the
service/repository/transaction layer works end to end. It deliberately
does **not** create Admin/Support/Customer accounts with real credentials
— that's Module 04's job, once password hashing exists; the seeded user
has no password at all.

**Run it with `npm run db:seed`, not `tsx prisma/seed.ts` directly.**
The seed script imports the shared `db` singleton, which (like most of
`lib/db` and `config/environment.ts`) imports the `server-only` marker
package. That package's `exports` map only resolves to a no-op under the
`react-server` condition — Next.js's bundler sets that condition
automatically inside the app, but a bare `tsx` invocation does not, and
`server-only` throws immediately on import instead
(`This module cannot be imported from a Client Component module`). Both
`package.json`'s `db:seed` script and `prisma.config.ts`'s
`migrations.seed` (which `prisma migrate reset` calls automatically) run
`tsx --conditions=react-server prisma/seed.ts` for this reason — found by
actually running the seed script against a real database during Module
03, not by inspection.

## Database host: Supabase

Alpha OS's Postgres runs on **[Supabase](https://supabase.com)** (decided
after Module 01's initial build, which shipped with no database
configured — no Docker or local PostgreSQL was available in that
environment). Supabase is a standard hosted Postgres instance underneath,
so nothing about the Prisma/driver-adapter wiring above changes — it's
just where `DATABASE_URL` points.

**Getting the connection string:** Supabase project → Project Settings →
Database → Connection string → "URI". Two variants matter:

| Variant | Port | Use for |
|---|---|---|
| Direct connection | `5432` | Everything — the app at runtime, and `prisma migrate` |
| Transaction pooler (PgBouncer) | `6543` | Only if deploying somewhere with many short-lived serverless invocations (e.g. Vercel functions) that would otherwise exhaust Postgres's connection limit |

**Use the direct connection unless you have a specific reason not to.**
PgBouncer's transaction mode doesn't support the prepared statements
`prisma migrate` needs, so migrations must run against the direct URL
regardless — and since Prisma 7 removed the separate `directUrl` concept
(one `url` in `prisma.config.ts`, see above), splitting pooled-for-app /
direct-for-migrations means either two env vars and a `prisma.config.ts`
branch, or just using the direct connection everywhere until connection
volume actually requires pooling. If you do need the pooled URL later,
append `?pgbouncer=true` to it.

Supabase also bundles Auth, Storage, and Realtime — worth deciding before
Module 04 (Authentication) and Module 56 (File Storage) whether to use
those instead of building independent implementations, since it changes
what those modules actually build. Not decided as of Module 01.

Put the value in **`.env`**, not `.env.local` — the Prisma CLI's dotenv
loader (used by `prisma.config.ts`) only reads `.env` by default, while
Next.js reads both, so `.env` is the one file both tools agree on. Both
are git-ignored (see `.gitignore`).

## Testing

Three separate tiers, per spec section 28 — never blur them together:

| Tier | Location | Needs a real database? | What it verifies |
|---|---|---|---|
| Unit | `tests/unit/**` | No | Pure logic — validation, formatting, error mapping, component behavior |
| Database integration | `tests/integration/db/**` | Yes | Real Prisma queries against real Postgres — constraints, cascades, transactions |
| E2E | `tests/e2e/**` (Playwright, Module 04) | Yes (+ a running app) | Full user flows through the actual UI — see `authentication.md` "Testing" |

Database integration tests run through the same `npm test` command as
everything else, but each file starts with
`describe.skipIf(!isDatabaseConfigured)` — with no `DATABASE_URL`, they
report as **skipped**, not passed and not failed, so a green `npm test`
never implies "the database layer was verified" when it wasn't. Run
`npm run test:db` to target just this tier once a database is available.

E2E tests (`npm run test:e2e`) are separate from `npm test` entirely
(a different runner, Playwright, not Vitest) and need the app actually
built and running first — each spec checks the app is reachable and
skips otherwise, the same "explicit skip, never fake a pass" principle.

**Getting a real Postgres to test against, without touching Supabase:**
this module's tests were verified against a local Homebrew Postgres
(`brew install postgresql@17`, `createdb alpha_os_dev`), not the project's
actual Supabase instance — a throwaway local database is the right target
for running migrations/tests repeatedly during development; save the
Supabase connection for staging/production and for once you actually want
the app itself to run against real hosted data. Point any command at it
with `DATABASE_URL="postgresql://$(whoami)@localhost:5432/alpha_os_dev" npm run <script>`.

**`prisma migrate reset` requires human confirmation.** The Prisma CLI
detects when it's being invoked by an AI agent and refuses to run
`migrate reset` (and other irreversible commands) without the operator
explicitly consenting first — it drops and recreates the entire target
database. Never work around this; if a clean slate is genuinely needed,
ask first the same way the CLI's own guard does.
