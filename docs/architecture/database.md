# Database Architecture (infrastructure)

Module 01 wires Prisma + PostgreSQL end-to-end but adds **no business
entities** — `prisma/schema.prisma` has only the generator and datasource
blocks. Real models (`User`, `Organization`, ...) are Module 03's job,
following the conventions below.

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

## Conventions every future model follows

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

## Seeding

`prisma/seed.ts` is development-only (refuses to run when
`NODE_ENV=production`) and currently seeds nothing, because there's no
schema yet to seed. It deliberately does **not** create Admin/Support/
Customer accounts — that's Module 04's job, once password hashing and a
real `User` model exist. Module 03 is where this file gets real content.

## Getting a real database

No Docker or local PostgreSQL was available in the environment this
module was built in. Three options, in order of least friction:

1. **[neon.tech](https://neon.tech)** — free tier, no local install,
   copy the connection string into `.env`'s `DATABASE_URL`.
2. Install PostgreSQL locally.
3. Run PostgreSQL via Docker once Docker is installed.

Put the value in **`.env`**, not `.env.local` — the Prisma CLI's dotenv
loader (used by `prisma.config.ts`) only reads `.env` by default, while
Next.js reads both, so `.env` is the one file both tools agree on. Both
are git-ignored (see `.gitignore`).
