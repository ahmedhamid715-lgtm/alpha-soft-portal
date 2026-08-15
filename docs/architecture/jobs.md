# Background Jobs

Future modules need async work for emails, reports, AI processing, SEO
crawling, notifications, imports/exports, and integration syncs. Module
01 establishes the `JobQueue` contract (`src/lib/platform/jobs.ts`) and a
working-but-non-durable inline implementation — the real queue is Module
57's job (Background Jobs).

## The contract

```ts
jobs.register("email.send", async (payload: { to: string; templateId: string }) => { ... });
await jobs.enqueue("email.send", { to: "...", templateId: "..." });
```

`JobPayloadMap` is the place future modules add their job names and
payload types — extend the interface, don't create a parallel one.

## `InlineJobQueue` — what it is and isn't

The default implementation runs a registered handler **immediately,
in-process**, when `enqueue()` is called. There is:

- **No retry.** A handler that throws is caught and logged — the job is
  gone, not requeued.
- **No persistence.** A restart mid-job loses it entirely.
- **No scheduling, no delay, no priority.**

This is enough for Module 01 to prove the interface shape works and to
let early modules depend on `JobQueue` without blocking on
infrastructure that doesn't exist yet. It is explicitly **not** suitable
for anything where losing a job would be a real problem — email sending,
billing operations, or anything customer-facing should wait for Module
57's real implementation (or be written defensively enough to tolerate
silent failure, which is rarely the right tradeoff).

## What Module 57 needs to preserve

Whatever queue Module 57 picks (a Postgres-backed queue is a natural fit
given the rest of the stack, but a managed service is also reasonable),
it should implement the same `JobQueue` interface so nothing that
depended on it in earlier modules needs to change — only the underlying
reliability characteristics improve.
