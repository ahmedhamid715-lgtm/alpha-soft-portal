# Domain Events

No real business events exist yet — `CustomerCreated`, `ProjectOverdue`,
`InvoicePaid`, and similar belong to the modules that own those entities
(13 CRM, 21 Project Management, 41 Billing, ...). Module 01 establishes
the conventions and a working-but-non-durable in-process bus
(`src/lib/platform/events.ts`) so those modules emit events consistently
instead of each inventing its own pattern.

## Conventions

- **Names are `PascalCase`, past tense**: `CustomerCreated`, not
  `CreateCustomer` or `customer_created`. The past tense matters — an
  event describes something that already happened, not a command to do
  something.
- **Payloads carry IDs and the minimal data a handler needs to decide
  whether to act** — not full entity dumps. A handler that needs more
  should look it up via the repository layer, not have it pushed into
  every event payload "just in case."
- **Handlers should be idempotent where feasible.** The in-process bus
  below has at-most-once, synchronous delivery, but the durable bus that
  eventually replaces it (Module 40) will have at-least-once semantics —
  designing handlers for idempotency now avoids a rewrite later.

## `InProcessEventBus` — what it is and isn't

```ts
events.on("SomeEvent", async (event) => { ... });
await events.emit("SomeEvent", payload);
```

This is real, working code — not a stub — but it is **synchronous and
non-durable**: handlers run in-process when `emit()` is called, a handler
throwing is caught and logged (not retried), and nothing survives a
process restart. That's an intentional, documented limitation, not an
oversight. It's enough for Module 01 to prove the interface shape works;
Module 38 (Workflow Automation Engine) and Module 40 (Event System) build
the durable version behind the same `EventBus` interface.

**Don't build real business logic that depends on event delivery being
reliable until Module 40 lands.** Use events for genuinely optional
side-effects (a log line, a cache invalidation) until then, not for
anything where a dropped event would be a real problem.
