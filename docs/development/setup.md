# Setup

## Prerequisites

- Node.js (this project was built and tested on v26.5.1; anything
  reasonably current should work)
- npm (bundled with Node)
- Git

Docker and a local PostgreSQL install are **not required** to run the app
— see the database note below.

## First-time setup

```sh
npm install        # also runs `prisma generate` via postinstall
cp .env.example .env
npm run dev
```

Visit `http://localhost:3000`. `npm run typecheck` will fail on a
completely fresh checkout only if you haven't run `npm install` yet
(it needs `next typegen`'s output and the generated Prisma client).

## Database (optional for Module 01, required from Module 03 on)

The app boots and `npm run build` succeeds with no database configured —
`/api/health/db` will just report `"unavailable"`. To get a real
database:

1. Easiest: create a free Postgres database at
   [neon.tech](https://neon.tech) (no local install) and copy its
   connection string.
2. Or install PostgreSQL locally.
3. Or run PostgreSQL via Docker, once Docker is installed.

Put the connection string in **`.env`** (not `.env.local`) as
`DATABASE_URL` — see `docs/architecture/database.md` for why `.env`
specifically. Then:

```sh
npm run db:migrate   # applies migrations, prompts to create the DB if needed
npm run db:seed      # currently a no-op scaffold — see database.md
```

## Approving install scripts

This project uses npm's script-allowlist security feature. If you add a
new dependency that has a postinstall/preinstall script, `npm install`
will warn instead of silently running it:

```sh
npm approve-scripts <package-name>
```

Only approve scripts from packages you've checked — see
`docs/architecture/security.md`.

## Environment variables

See `.env.example` for the full, documented list. Everything is optional
in Module 01 except `NODE_ENV` (which Next.js sets for you) — the app is
designed to boot cleanly before every downstream module's secrets exist.
