# Cross-Cutting Conventions

Quick reference for the conventions every future module should follow
regardless of domain. Most of these are covered in depth elsewhere —
this file is the index, not a duplicate.

| Convention | Rule | Where |
|---|---|---|
| **IDs** | UUIDv7 via `generateId()`, never auto-increment or UUIDv4 | `src/lib/utils/id.ts`, `database.md` |
| **Timestamps** | UTC storage, `@db.Timestamptz(3)` columns, convert to local time only at presentation via `formatInTimeZone()` | `src/lib/utils/datetime.ts`, `database.md` |
| **Money** | Integer minor units (cents), never `Float`; convert at input/display boundaries only via `toMinorUnits()`/`formatMoney()` | `src/lib/utils/money.ts`, `database.md` |
| **Soft-delete / archive** | Decided per entity category — `Softdeletable` for user-deletable records, `Archivable` for historically-significant records, hard delete only for disposable data | `src/types/lifecycle.ts`, `data-modeling.md` |
| **Data access** | UI/API → service (validates + orchestrates) → repository (typed Prisma access) → Prisma. Never query Prisma directly from a component or route handler | `server/services/organization-service.ts`, `server/repositories/*` |
| **Pagination** | Offset (`page`/`limit`) for small-to-medium lists, cursor for large/high-churn datasets; total counts are opt-in, not automatic | `src/lib/platform/pagination.ts` |
| **Validation** | Every trust boundary goes through a Zod schema + `parseOrThrow()` | `src/lib/validation/parse.ts`, `security.md` |
| **Errors** | Throw or translate to an `AppError` subclass; never let a raw error cross a service boundary | `errors.md` |
| **Logging** | `logger` from `@/lib/logging`, never `console.log`; context, not string interpolation | `logging.md` |
| **API responses** | `apiSuccess`/`apiError` — one contract for every endpoint | `errors.md` |
| **Server/client boundary** | `import "server-only"` on anything that could leak a secret | `security.md` |

## Locale/timezone/currency defaults

Until Module 06 (Organizations) adds per-organization settings,
`config/app.ts`'s `appConfig.defaults` (`en-US`, `America/New_York`,
`USD`) is the fallback used everywhere. Don't hardcode these values a
second time elsewhere — import `appConfig`.
