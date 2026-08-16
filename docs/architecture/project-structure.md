# Project Structure

```text
src/
├── app/                    # Next.js App Router — pages, layouts, route handlers
│   ├── api/                #   Route Handlers (route.ts) — see errors.md for the response contract
│   │   └── auth/[...nextauth]/route.ts  # Auth.js's handler — see authentication.md
│   ├── (public)/           #   Unauthenticated pages: login, forgot/reset-password, verify-email (Module 04)
│   ├── (protected)/        #   Authenticated placeholder pages: admin, support, dashboard (Module 04) —
│   │                            NOT real Admin/Support/Customer UI, see authentication.md "Protected routes".
│   │                            admin/roles/ (Module 05) is the one real, permission-gated page here —
│   │                            see authorization.md "UI". organizations/ (Module 06) is the
│   │                            other — organization listing/switching, see multi-tenancy.md
│   ├── layout.tsx          #   Root layout — fonts, TooltipProvider, Toaster
│   └── globals.css         #   Design tokens (primitive → semantic → component)
│
├── auth.ts                  # Auth.js (NextAuth v5) config — see authentication.md
├── proxy.ts                  # Next.js 16 proxy (coarse route protection only — see authentication.md
│                                 "proxy.ts stays cheap on purpose")
│
├── components/
│   ├── ui/                 #   shadcn/ui primitives (Button, Card, Dialog, ...) — generated,
│   │                           edit with care; re-run `npx shadcn add <name>` for new ones
│   ├── layout/              #   App shells/nav (empty until Module 09/20/32 build real dashboards)
│   └── shared/              #   Cross-cutting components that aren't shadcn primitives
│
├── config/                  # Centralized, typed configuration — see configuration.md
│   ├── environment.ts       #   Server-only env (Zod-validated); import `serverEnv`, never process.env
│   ├── environment.public.ts#   NEXT_PUBLIC_* only — safe for client bundles
│   ├── app.ts                #   Non-secret app config + default feature flags
│   └── navigation.ts         #   Nav item schema future dashboards populate
│
├── lib/
│   ├── utils.ts                # shadcn/ui's `cn()` class-merging helper — DO NOT MOVE, its
│   │                              path is a hardcoded convention every `npx shadcn add`
│   │                              component imports from (`@/lib/utils`, see components.json)
│   ├── auth/                  # Password hashing/policy, tokens, session-guard, role→destination
│   │                              routing (Module 04) — see authentication.md
│   ├── authorization/            # Permission/role catalogs, context resolution, the can/
│   │                                requirePermission/authorize engine, resource policies
│   │                                (Module 05) — see authorization.md and rbac.md
│   ├── tenancy/                    # withTenantContext() (RLS transaction/context setter),
│   │                                  the restricted-role Prisma client, organization
│   │                                  selection/switching (Module 06) — see multi-tenancy.md
│   │                                  and rls.md. Import `withTenantContext` from
│   │                                  `lib/tenancy/context` directly (not the `lib/tenancy`
│   │                                  barrel) from anywhere that must stay runnable outside
│   │                                  Next's bundler (tests) — the barrel also re-exports
│   │                                  `organization-selection.ts`, which needs `next/headers`.
│   ├── mail/                    # Mail provider abstraction (Module 04) — see authentication.md "Email"
│   ├── db/                   # Prisma singleton (the migration/owner role), error translation,
│   │                              transactions, health check. Module 06 added a SECOND,
│   │                              separate Prisma client (`lib/tenancy/client.ts`, the
│   │                              restricted role RLS applies to) — not here, deliberately;
│   │                              see rls.md "The restricted role."
│   ├── errors/                # AppError taxonomy + API response contract — see errors.md
│   ├── logging/                # Structured logger — see logging.md
│   ├── validation/              # Zod boundary-validation helpers — see conventions.md
│   ├── utils/                    # NOT the same thing as lib/utils.ts above (naming collision
│   │                                is intentional — shadcn owns the file, we own the
│   │                                directory): ID (UUIDv7), date/time (UTC), money (integer
│   │                                minor units). New non-UI utility conventions go here.
│   └── platform/                  # Abstractions future modules implement against:
│                                      feature-flags, storage, jobs, events, cache, pagination,
│                                      search, rate-limit (now has a real InMemoryRateLimiter,
│                                      not just the no-op default — see authentication.md),
│                                      request-id, route-handler
│
├── server/
│   ├── services/              # Business logic — validates input, orchestrates repositories,
│   │                              wraps multi-write operations in withTransaction() (see
│   │                              organization-service.ts for the pattern). Module 04 added
│   │                              auth-service.ts, session-service.ts, password-reset-service.ts,
│   │                              email-verification-service.ts. Module 05 added role-service.ts
│   │                              (role CRUD, permission grants, role assignment — the
│   │                              privilege-escalation/last-owner chokepoint, see authorization.md)
│   │                              and membership-service.ts (member removal/status, shares the
│   │                              same last-owner guard).
│   └── repositories/          # Data-access layer over Prisma — typed, tx-composable, no
│                                  validation of its own (see organization-repository.ts).
│                                  Module 04 added credential-repository.ts, session-repository.ts,
│                                  auth-token-repository.ts. Module 05 added role-repository.ts,
│                                  permission-repository.ts.
│
├── types/                     # Cross-cutting types not owned by a specific module (lifecycle.ts,
│                                  next-auth.d.ts — Auth.js session/JWT type augmentation)
├── styles/                     # Reserved for non-Tailwind styling needs; empty for now
└── generated/prisma/            # Prisma Client output — GENERATED, git-ignored, never hand-edit
                                     (regenerated by `npm run db:generate`, also runs on `npm install`)

prisma/
├── schema.prisma               # Organization/User/OrganizationMembership (Module 03) +
│                                    UserCredential/UserSession/AuthToken (Module 04) +
│                                    Role/Permission/RolePermission (Module 05) — see
│                                    docs/architecture/database-schema.md, authentication.md, rbac.md
├── migrations/                 # Prisma-generated SQL, one directory per migration — never hand-edit
│                                    (two Module 05 migrations include a hand-added partial unique
│                                    index each — see rbac.md "The NULL-uniqueness gap" and
│                                    "isPlatform")
├── seed.ts                     # Dev-only seed script — see database.md "Seeding"
└── seed-rbac.ts                 # Module 05's permission/role catalog seed + its own dev fixtures
                                     (a platform org + two customer orgs) — see rbac.md "Seeding"

docs/
├── architecture/                # Why decisions were made (this directory)
└── development/                 # How to actually run/test the thing

scripts/                         # One-off maintenance/verification scripts, not in prisma/ or lib/ —
                                     e.g. verify-auth-security.sh (re-runnable, real HTTP+DB checks
                                     of Module 04's core security claims)
playwright.config.ts             # E2E test config (Module 04) — see authentication.md "Testing"
tests/
├── unit/                        # Vitest unit tests, mirrors src/ structure — no database needed
├── integration/db/              # Real-Postgres tests — self-skip without DATABASE_URL, see database.md "Testing"
├── e2e/                         # Playwright E2E specs — self-skip if the app isn't reachable, see
│                                    playwright.config.ts and authentication.md "Testing"
└── setup/                       # Vitest global setup (env stubs, jsdom matchers, etc.)
```

## Where new code goes

- **A new platform-wide capability with no owner module yet** (e.g. "we
  need email sending"): add the interface to `lib/platform/`, following
  the pattern in `storage.ts`/`jobs.ts` — an interface, a working or
  explicitly-throwing default implementation, and a comment naming which
  future module wires the real thing.
- **Business logic for a specific module** (e.g. Module 13's CRM lead
  scoring): `server/services/`, calling into `server/repositories/` for
  data access. Never query Prisma directly from a component or a route
  handler — that's what the repository layer is for once Module 03 adds
  real entities.
- **A new Route Handler**: wrap it with `createRouteHandler` from
  `lib/platform/route-handler.ts` (see `src/app/api/health/route.ts` for
  the pattern) — this is what gives every endpoint a request ID,
  structured logging, and the standard error contract for free.
- **A new shadcn/ui primitive**: `npx shadcn add <component>`, don't
  hand-write one — see `docs/development/commands.md`.

## Import alias

`@/*` maps to `src/*` (see `tsconfig.json`). Always import via `@/...`,
never a relative `../../../` chain across top-level directories.
