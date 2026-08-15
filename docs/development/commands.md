# Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) at `localhost:3000` |
| `npm run build` | Production build |
| `npm run start` | Run the production build (`npm run build` first) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` (generates route-based global types) then `tsc --noEmit` — see `docs/architecture/platform-core.md` for why both are needed |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:generate` | Regenerate the Prisma client (`src/generated/prisma`) — also runs automatically via `postinstall` |
| `npm run db:migrate` | `prisma migrate dev` — create/apply a migration locally |
| `npm run db:deploy` | `prisma migrate deploy` — apply pending migrations in CI/production, no prompts |
| `npm run db:seed` | Run `prisma/seed.ts` (dev-only; no-op until Module 03 adds real entities) |
| `npm run db:studio` | Open Prisma Studio |

## Adding a shadcn/ui component

```sh
npx shadcn@latest add <component-name>
```

Don't hand-write files in `src/components/ui/` — they're meant to be
generated/updated via the CLI so they stay consistent with the rest of
the design system.

## Quality gate (what CI should run)

```sh
npm run lint && npm run typecheck && npm test && npm run build
```

All four must pass before a change is considered done — this is the same
sequence Module 01 itself was verified against.
