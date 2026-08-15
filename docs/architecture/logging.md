# Logging

## Use `logger`, never `console.log`

Import `logger` from `@/lib/logging` everywhere in server code. It's a
structured JSON logger (`ConsoleLogger`, `src/lib/logging/console-logger.ts`)
behind a `Logger` interface — the interface is what matters for future
code, since Module 58 (Observability) will swap the implementation for a
real provider (Datadog, an OpenTelemetry exporter, ...) without any call
site changing.

## Levels

`debug` < `info` < `warn` < `error`. Controlled by the `LOG_LEVEL`
environment variable (default `info`) — anything below the configured
level is filtered before it's written, not after, so a noisy `debug` line
in a hot path costs nothing in production.

## Context and correlation

```ts
logger.info("Ticket created.", { requestId, operation: "tickets.create", ticketId });
```

For request-scoped logging (the common case in Route Handlers), use
`logger.child({ requestId })` once and reuse the returned logger for the
rest of the request instead of passing `requestId` to every call —
`createRouteHandler` already does this for you (see `errors.md`).

`LogContext` also has `userId`/`organizationId` fields, unused until
Module 04/06 exist. Populate them via `.child()` once those modules land;
don't add new logger methods for them.

## What must never be logged

Per spec section 17, explicitly: passwords, tokens, API keys, session
secrets, unnecessary sensitive customer information. This isn't
per-call-site discipline — `redact()` (`src/lib/logging/redact.ts`) walks
every context object before it's serialized and replaces the value of
any key matching a sensitive-name pattern (`password`, `secret`, `token`,
`api[_-]?key`, `authorization`, `session[_-]?id`, `credit[_-]?card`,
`ssn`, ...) with `"[redacted]"`, recursively, regardless of nesting
depth. If a future field genuinely needs logging but its name happens to
match the pattern, rename the field — don't work around the redactor.
