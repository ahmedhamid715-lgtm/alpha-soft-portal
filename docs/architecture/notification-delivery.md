# Notification delivery — lifecycle, channels, retry

The deep dive on the `NotificationDelivery` half of Module 09. See
`notifications.md` for the domain model this builds on and the "reuse"
table; this file is the honest accounting of what actually sends a
message, what "sent" means, and what happens when it doesn't work —
Phase 33's own instruction: "documentation must describe what actually
exists," not a future queue dressed up as a present one.

## One delivery row per (notification, channel)

`lib/notifications/delivery.ts:queueDeliveries()` creates one
`NotificationDelivery` row per channel `lib/notifications/policy.ts`'s
`resolveChannels()` decided to attempt, all `PENDING`, inside the same
transaction as the parent `Notification` insert. A notification with
both `IN_APP` and `EMAIL` resolved has two delivery rows from the start
— never one row with a "channels" array, so each channel's own
attempt/failure/retry state is independent (an email bounce never
touches the in-app row, which is already logically "delivered" the
moment the `Notification` exists).

## The lifecycle

```
PENDING → SENT        (accepted by the channel)
PENDING → FAILED      (terminal — not retryable, or retries exhausted)
PENDING → CANCELLED   (channel not implemented — SMS/PUSH; never attempted)
PENDING → PENDING     (retryable failure — attemptCount++, nextAttemptAt set)
```

`PROCESSING` exists in the `NotificationDeliveryStatus` enum (spec
section 4.2 asks for it) but nothing in this module's own code path
ever writes it — `processDelivery()` (below) runs a single attempt
start-to-finish synchronously, so there's no observable window where a
row sits "in progress." It's reserved for a future worker that claims a
row, marks it `PROCESSING`, then processes it out-of-band — the state
exists in the schema now so that migration doesn't need a new enum
value later.

**A delivery is never marked `SENT` because the application called a
provider.** `emailProvider.send()` either resolves with
`EmailSendResult` (accepted, with an optional `providerMessageId`) or
throws `EmailDeliveryError` — `processDelivery()` only writes `SENT` on
the resolved path. `IN_APP` is the one channel where "sent" is
definitionally immediate: the `Notification` row's own existence *is*
the in-app delivery (there's no external system to accept or reject
it) — its delivery row exists for lifecycle/observability symmetry with
every other channel, not because anything could plausibly fail.

## Processing — synchronous today, worker-ready by contract

No durable job queue exists anywhere in this codebase yet
(`lib/platform/jobs.ts` is Module 01's own "interface now, real backend
later" placeholder — this module doesn't touch it, because it isn't a
job *definition* system, it's a delivery *record* system). What
actually runs: `notificationService.notify()` queues every delivery
inside its transaction, then — **after** that transaction commits, not
inside it — calls `processDelivery()` for each one, synchronously, in
the same request/event-handler invocation.

This is a deliberate, honest choice, not an oversight:

- An external HTTP call (a real email API) must never happen while a
  database transaction holding row locks is still open — that's the
  textbook way to turn a slow third-party API into a database outage.
- `processDelivery(deliveryId)` takes only an id and is idempotent (a
  no-op if the row is no longer `PENDING`) — the exact shape a future
  background worker, cron job, or CLI script needs to call it safely,
  including re-processing after a crash without double-sending.
- `processDueDeliveries(limit = 50)` (spec section 15's own asked-for
  entry point) already exists and already queries `nextAttemptAt <=
  now` correctly — the day a real queue/worker exists, it calls this
  function; nothing about `delivery.ts` needs to change.

**What this means today, plainly stated**: if the process crashes
between the transaction commit and `processDelivery()` running, that
delivery stays `PENDING` with `nextAttemptAt: null` until something
calls `processDueDeliveries()` — which nothing currently schedules.
This is the real, current limitation, not a hidden one. It's the same
category of gap `jobs.ts` already documents for the whole codebase, not
a Module-09-specific shortcut.

## Retry classification

`classifyFailure()` maps a thrown error to `{ code, message, retryable
}`:

- An `EmailDeliveryError` (thrown by `EmailProvider.send()`) already
  carries this classification — the provider itself decides
  retryable-vs-terminal (an invalid recipient never becomes valid on
  retry; a timeout might resolve).
- Any other thrown error (a bug, an unwrapped network exception) is
  treated as **non-retryable**, logged with a generic `unknown_error`
  code, and its real message is never persisted — see
  `notification-security.md` "Provider error leakage."

Backoff is exponential and capped: `min(60, 5^attemptCount)` minutes —
1, 5, 25, 60, 60 for attempts 1 through 5. `MAX_ATTEMPTS = 5`; once
reached (or the failure was never retryable), the row moves to `FAILED`
with `nextAttemptAt: null` and a best-effort
`notification.delivery.failed` audit event is recorded (Module 08,
reused — see the catalog entry). Not configurable per-channel/provider
yet — a plausible future need, not built speculatively (spec's own
"do not over-engineer" instruction).

## Channel architecture

```ts
interface NotificationChannel { // conceptual — not a TS interface in this codebase;
  send(): …                     // IN_APP/EMAIL are handled directly inside
  validate(): …                 // delivery.ts's own switch, not through a
  supports(): …                 // shared base class, because there are only
  getCapabilities(): …          // two real implementations and a third
}                                // abstraction layer would be premature.
```

`SMS`/`PUSH` are real enum values (`NotificationChannel`) with **no
implementation** — `queueDeliveries()` never resolves them (no category
lists them in `supportedChannels`), and if a future category ever did,
`processDelivery()`'s own switch would move that row straight to
`CANCELLED` with `failureCode: "channel_not_implemented"` rather than
silently doing nothing or crashing. This is what spec section 5 means
by "create interfaces/contracts so they can be implemented later" —
the enum, the delivery-row shape, and the lifecycle are all
channel-agnostic already; only the actual send call is missing.

## Email provider abstraction

`lib/mail/mailer.ts` — extended in place from Module 04's original
minimal `MailProvider`/`mailer` (a single `send(): Promise<void>`, no
result shape) into `EmailProvider`/`emailProvider`:

```ts
interface EmailProvider {
  getName(): string;
  validateConfiguration(): { valid: boolean; reason?: string };
  send(message: EmailMessage): Promise<EmailSendResult>; // throws EmailDeliveryError
}
```

Every existing call site (`sendVerificationEmail`,
`sendPasswordResetEmail`, `sendInvitationEmail`) kept its exact
signature and needed no changes — the extension only added
capability, it didn't move anything.

**`ConsoleEmailProvider`** is the only real implementation today —
`getName()` returns `"console"`, `validateConfiguration()` always
reports valid (there's no external credential to check), and `send()`
logs the message to the server console, clearly labeled non-production,
then resolves `{ accepted: true }`. A recipient address containing
`+delivery-fail` (e.g. `user+delivery-fail@example.com`) makes it throw
a deterministic retryable `EmailDeliveryError` — the one hook this
module's own retry-path tests use to exercise a real failure without a
real provider. `EMAIL_PROVIDER`/`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`
(`config/environment.ts`, `.env.example`) select and configure it —
server-only, never `NEXT_PUBLIC_*`; any value other than `"console"`
(including unset) falls back to it with a logged warning rather than
throwing at boot.

## Idempotency, at the delivery layer

The idempotency *guarantee* lives one layer up — `Notification.idempotencyKey`
(see `notifications.md` section 4.5) means a duplicate `notify()` call
never gets far enough to queue a second set of deliveries at all. At the
delivery layer itself, `processDelivery()`'s own "no-op unless still
`PENDING`" check is what makes re-invoking it for the same id safe
(spec section 16's "test concurrent... delivery processing"): two
concurrent callers racing to process the same delivery both read the
row, but only one's `UPDATE` actually lands as the meaningful state
transition — the loser's write still succeeds (there's no optimistic-
lock version column), but writes semantically the same terminal state,
so no double-send occurs even though this isn't SELECT-FOR-UPDATE-guarded.
This is a real, acceptable gap for a single in-process synchronous
caller (nothing today calls `processDelivery()` from two places for the
same id at once) — worth strengthening with a row lock the day a real
concurrent worker pool exists, not before.

## Observability

Platform staff with `notifications.observability` see delivery rows —
never `Notification.title`/`body` for a customer's own message — via
`lib/notifications/observability.ts:listDeliveries()` and
`/admin/notifications`. See `notification-security.md` "What platform
staff can and cannot see" for the exact boundary.

## What was deliberately not built

- A durable queue/worker — see "Processing" above.
- Per-channel/per-provider backoff configuration.
- Row-level locking on delivery processing (SELECT ... FOR UPDATE) —
  acceptable today because nothing calls `processDelivery()` concurrently
  for the same id; revisit when a real worker pool does.
- SMS/PUSH implementations — interfaces/enum values only.
- Delivery webhooks (provider-initiated status updates, e.g. a bounce
  notification arriving after the fact) — `providerMessageId` is stored
  specifically so this is addable later without a schema change.
