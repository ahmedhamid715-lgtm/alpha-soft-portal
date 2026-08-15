# Error Architecture & API Response Contract

## The `AppError` taxonomy (`src/lib/errors/app-error.ts`)

Every error that crosses an API boundary should be — or be translated
into — one of: `ValidationError` (400), `AuthenticationError` (401),
`AuthorizationError` (403), `NotFoundError` (404), `ConflictError` (409),
`RateLimitError` (429), `DatabaseError` (500), `ExternalServiceError`
(502), or `InternalServerError` (500, the catch-all for anything
unanticipated).

**`isOperational` matters.** It's `true` for every subclass above except
`InternalServerError` — it distinguishes errors the application
anticipated and handled on purpose (bad input, missing record, expired
session) from a genuine bug or unhandled condition. `AppError.message` is
**always** author-controlled, safe text — never raw driver/library error
text. A `DatabaseError`'s message is "A database error occurred.", not
whatever Postgres actually said; the real diagnostic detail goes into
`cause`, which only reaches logs and the dev-only debug block, never a
production API response.

**Rule: never throw a raw error across a service/repository boundary.**
If you catch a Prisma error, translate it with `translatePrismaError()`
(see `database.md`). If you catch anything else unexpected, let
`toAppError()` normalize it to an `InternalServerError` rather than
re-throwing the original.

## What must never reach a client

Per spec section 14, explicitly: stack traces, SQL queries, secrets,
internal filesystem paths, database credentials. `AppError.toSafeJSON()`
is the enforcement point — it returns only `{ code, message, details? }`,
never `stack` or `cause`. Development environments get additional
diagnostics (see below), production does not.

## API response contract (`src/lib/errors/api-response.ts`)

Every Route Handler returns one of two shapes:

```jsonc
// Success
{ "success": true, "data": { ... } }

// Error
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Ticket was not found.",
    "details": { "...": "..." },       // optional, safe structured info
    "requestId": "...",
    "debug": { "name": "...", "stack": "...", "cause": "..." } // dev-only
  }
}
```

`apiSuccess(data, status?)` and `apiError(error, requestId)` are the only
two functions that should construct these — don't hand-roll
`Response.json({...})` in a route handler.

## Request correlation IDs (`src/lib/platform/request-id.ts`)

Every request gets an ID — reused from an incoming `x-request-id` header
if present and well-formed, otherwise minted fresh. It's threaded through
structured logs (see `logging.md`) and echoed in every API error
response, so a single reported failure can be traced across
"API → database → background job → AI → external integration" without
guessing which log lines belong together.

## Using this from a Route Handler

Don't build this by hand per-route — wrap with `createRouteHandler`
(`src/lib/platform/route-handler.ts`), which gives you a request ID,
structured request logging, and this exact error contract automatically.
See `src/app/api/health/route.ts` for the pattern; `project-structure.md`
for where new handlers belong.
