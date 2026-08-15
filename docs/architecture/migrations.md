# Migration Strategy (Module 03)

## Commands

| Environment | Command | What it does |
|---|---|---|
| Local development | `npm run db:migrate` (`prisma migrate dev`) | Diffs the schema against the database, generates a new migration if needed, applies it, regenerates the client |
| CI / staging / production | `npm run db:deploy` (`prisma migrate deploy`) | Applies pending migrations only — never generates one, never prompts, safe to run unattended in a deploy pipeline |
| Reset to a known state (local only) | `npx prisma migrate reset` | Drops and recreates the database, reapplies every migration, re-runs `prisma/seed.ts` |

**Never run `prisma migrate dev` against staging or production** — it can
prompt interactively and is designed for the local schema-authoring loop,
not for applying already-reviewed migrations. `migrate deploy` is the
only command that belongs in a deploy pipeline.

**`prisma migrate reset` is destructive and requires human confirmation.**
The Prisma CLI itself detects AI-agent invocation and refuses to run it
(or other irreversible commands) without the operator's explicit,
in-the-moment consent — see `database.md` "Testing." This is a real
safety mechanism, not an obstacle to route around.

## Review

Every migration is a plain SQL file under `prisma/migrations/<timestamp>_<name>/migration.sql`
— read it before committing, the same as any other diff. Prisma generates
correct SQL for the schema change you asked for, not necessarily the
*safest* SQL for a live database with real traffic (see "Destructive
changes" below) — that judgment is still the author's, not the tool's.

## Rollback

**Prisma does not auto-generate a down-migration.** There is no
`prisma migrate rollback` — "rolling back" a bad migration in production
means either:

1. Writing and applying a new forward migration that undoes the change
   (the normal path — a migration history should read as a forward-only
   log of what actually happened to the schema), or
2. Restoring from a database backup/point-in-time recovery (Supabase
   supports this), for the rare case where (1) isn't safe or possible
   (e.g. a migration that already dropped a column full of data no
   forward migration can reconstruct).

Never assume a migration can simply be reversed. Test any migration that
worries you against a copy of production-shaped data first, not directly
against production.

## Destructive changes: expand → migrate → contract

A destructive change — dropping a column, renaming a column, changing a
column's type, adding a `NOT NULL` constraint to a column with existing
rows — is never a single migration against a database serving live
traffic. The safe pattern has three phases, each its own migration,
each independently deployable:

1. **Expand**: add the new shape alongside the old one. A column rename
   becomes "add the new column" (nullable, no constraint yet). A type
   change becomes "add a new column with the new type." The application
   at this point doesn't need to know about the new column yet — this
   migration is additive-only and safe to deploy without any code change.
2. **Migrate data, then switch the application**: backfill the new
   column from the old one (a data migration, not a schema migration —
   a one-off script, not a `migration.sql`), deploy application code that
   writes to *both* columns and reads from the *new* one, verify, then
   deploy application code that only touches the new column.
3. **Contract**: once nothing reads or writes the old column anymore, a
   final migration drops it.

Skipping straight to "drop the old column, add the new one, deploy new
code" in one migration means there is a real window — however short —
where the currently-running application code (built against the old
schema) breaks against the now-migrated database, or vice versa if the
deploy order goes the other way. The three-phase version has no such
window at any point.

## What Module 03 actually shipped

One migration: `20260815173856_init_platform_foundation` — creates
`organizations`, `users`, `organization_memberships`, their three enums,
all indexes, and both foreign keys. Generated and applied against a real
local Postgres (see `database.md` "Testing"), not hand-written — verify
this is still true by reading `prisma/migrations/*/migration.sql`
directly rather than trusting this sentence as the schema evolves.
