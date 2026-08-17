# Notification security & trust model

The honest accounting of what Module 09 guarantees and what it doesn't
— same discipline `audit-security.md` established for Module 08: state
it plainly, prove the provable claims with tests, and don't claim more
than what's actually enforced.

## Trust boundaries — never client-supplied

Every one of these is always server-resolved, never accepted from
request input, on every path that writes a `Notification`,
`NotificationDelivery`, or `NotificationPreference` row:

- **Recipient** — `notify()`'s `recipientUserId` comes from the calling
  event subscriber (`lib/notifications/subscribers.ts`), itself
  resolved from a real domain event's own server-verified payload
  (e.g. `membership.userId`, never a request field). Every *read/mutate*
  operation on an existing notification (`markRead`/`markUnread`/`archive`/
  `getUserNotifications`/`getNotification`) resolves the recipient from
  `getCurrentUser()` — there is no `recipientUserId` parameter on any
  of these functions to forge in the first place (see `service.ts`'s
  own top comment).
- **Organization** — always the server-side event/transaction's own
  tenant context, never a form field.
- **Preference ownership** — `updatePreference()`/`listPreferences()`
  resolve `userId` from `getCurrentUser()` only.
- **Delivery status/attemptCount/failure classification** — written only
  by `lib/notifications/delivery.ts`, running under platform tenant
  context (`isPlatformStaff: true`, the same "acting as the system"
  shape used elsewhere in this codebase), never by a client request.

## IDOR — the actual mechanism, not just a check

`markRead`/`markUnread`/`archive` don't check "does this notification
belong to the caller" as a conditional — they structurally cannot act on
anyone else's notification, because the recipient is never a parameter.
Two independent layers enforce this identically:

1. **Application**: `notificationRepository.updateStatus(id, recipientUserId, ...)`
   uses `updateMany({ where: { id, recipientUserId } })` — a forged id
   for someone else's notification matches zero rows, translated to a
   `NotFoundError` (never `PermissionDeniedError` — the same
   enumeration-avoidance discipline every other IDOR-sensitive lookup in
   this codebase follows: a nonexistent notification and someone else's
   notification must be indistinguishable from the response).
2. **Database (RLS)**: `notifications`' own `recipient_isolation_update`
   policy independently rejects the same UPDATE at the Postgres layer —
   `USING (recipient_user_id = tenant_current_user_id())`. Even a future
   bug that removed the application-layer `WHERE recipientUserId` clause
   would still be caught here. Proven directly against the real,
   restricted `alpha_os_app` role in `tests/integration/db/notification-rls.test.ts`
   ("recipient B cannot UPDATE recipient A's notification").

`getNotification`/`getUserNotifications` follow the same two-layer
shape for SELECT.

## RLS — the structurally different shape

`notifications`' SELECT/UPDATE policies are keyed on `recipient_user_id`,
**not** organization membership — see `notifications.md`'s own
"Notification — recipient-owned, organization-*associated*" for why:
the real access boundary is the recipient, and two members of the SAME
organization must never see each other's personal notification feed.
This is worth stating plainly because it's a genuinely different shape
than every other RLS-protected table in this codebase (all keyed on
`organization_id = tenant_current_organization_id()`), not a mechanical
copy-paste that happens to also work.

`notification_deliveries` has **no regular-user SELECT/UPDATE path at
all** — platform-context-only (`tenant_is_platform_context()`). A
customer never queries delivery internals directly.

`notification_preferences` has **no RLS** — see `notification-preferences.md`
"Ownership and authorization" for why (global identity data, protected
by an ordinary service-layer ownership check, same category as `User`).

All of the above is proven against the real, restricted `alpha_os_app`
role — never a superuser — in `tests/integration/db/notification-rls.test.ts`:
recipient isolation within one organization, UPDATE forgery, cross-org
`NotificationDelivery` `WITH CHECK` rejection, the platform-only
delivery SELECT boundary, the DELETE `REVOKE`, and the "no context fails
closed" case (`tenant_current_user_id()` is `NULL` with no context set,
and `recipient_user_id = NULL` is never `TRUE` in SQL).

## What's audited, and what isn't

Reused verbatim — Module 08's `audit.recordSuccess/Failure/Denied()`,
no second audit system. Four actions, deliberately restrained (same
"don't audit every trivial SELECT" discipline the audit catalog already
applies elsewhere):

| Action | When | Category |
|---|---|---|
| `notification.archived` | A user archives their own notification | DATA |
| `notification.preference.updated` | A user changes a preference | DATA |
| `notification.delivery.failed` | A delivery reaches a terminal failure | SYSTEM |
| `notification.test.sent` | Platform staff sends a test notification | ADMINISTRATION |
| `notification.provider.changed` | The configured email provider changes | ADMINISTRATION |

**Deliberately not audited**: mark-read, mark-unread, mark-all-read.
These are meaningless-to-security-review UI interactions (spec's own
"no audit events for meaningless UI interactions" precedent) — auditing
every read-state toggle would flood the trail with noise that never
helps an investigation. Archiving *is* audited because it's a real,
if minor, content-management decision with a visible before/after state.

Every audit write here is **best-effort**: caught and logged, never
allowed to turn a successful mutation into a user-facing error — the
same failure-semantics table `audit-system.md` documents.

## What platform staff can and cannot see

`notifications.observability` (PLATFORM scope) grants
`lib/notifications/observability.ts:listDeliveries()` — channel,
provider, status, `attemptCount`, timestamps, `failureCode`/`failureReason`.
It does **not** grant `Notification.title`/`body` for a customer's own
message — the observability query only ever touches
`NotificationDelivery`, and `/admin/notifications` never joins in or
renders the parent notification's content. Platform staff diagnosing a
delivery failure sees *that* delivery X to organization Y failed with
code `provider_timeout`; they do not see what the message said. This
mirrors `audit.readPlatform`'s own reasoning (an operational permission,
never an implicit grant of customer content) named explicitly in
`notifications.md`'s "Authorization model."

`notifications.manageProvider` (PLATFORM scope, more privileged) gates
`getProviderStatus()` (a synchronous configuration-health check — never
a live send) and `sendTestNotification()` (a real send to a
staff-supplied address, to verify the provider end-to-end — never
writes a `Notification`/`NotificationDelivery` row, so a test send never
appears in anyone's feed or the observability list).

Platform staff are **not** automatically granted access to a specific
customer's own notification feed merely by being platform staff — there
is no code path where `isPlatformStaff: true` widens the `recipient_isolation_select`
policy (unlike `audit_events`, whose SELECT policy *does* have an
explicit platform-context bypass — a deliberate, documented asymmetry:
audit events are evidence platform staff may legitimately need to see
broadly; a customer's personal inbox is not). See `notifications.md`
"NotificationDelivery — operational, platform-observable only" for the
one intentional exception (delivery *metadata*, never notification
*content*).

## Provider error leakage

`EmailDeliveryError.message` is always the provider adapter's own
already-sanitized string — never a raw exception message, stack trace,
or provider SDK error object. `classifyFailure()`
(`lib/notifications/delivery.ts`) additionally treats any *unwrapped*
error (a bug, a network exception the provider adapter didn't catch and
translate) as non-retryable with a generic `unknown_error` code — its
real message is **never** persisted to `failureReason`, logged to the
audit trail's metadata, or exposed to any user, including platform staff
on the observability page. `failureReason` shown at `/admin/notifications`
is therefore always either a deliberately-authored provider message or
the generic fallback string — never a raw stack trace.

## Secrets

`EMAIL_PROVIDER`/`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME` (and any future
provider API key) live only in `serverEnvSchema`
(`config/environment.ts`) — never `NEXT_PUBLIC_*`, never referenced from
a Client Component. `Notification.metadata`/`NotificationDelivery.metadata`
are passed through `lib/audit/redact.ts`'s existing redaction (Module 08,
reused) before being written — the same discipline applied to audit
event metadata, so a future template author accidentally interpolating
a token into `templateData` doesn't persist it verbatim.

## Mandatory-notification suppression

A client cannot suppress a mandatory category/channel combination —
`updatePreference()` rejects the write outright (`ValidationError`)
before any row is touched; there is no state a client can put the
database in where a mandatory channel silently stops being attempted.
See `notification-preferences.md` "Mandatory vs. optional" for the full
two-layer enforcement (`policy.ts` ignoring a stored `false` for
mandatory channels is defense-in-depth on top of this, not the only
protection).

## Idempotency and concurrency

`Notification.idempotencyKey` (`String @unique`) is the real,
structural guarantee — proven under genuine concurrency (`Promise.all`
of two simultaneous `notify()` calls for the same event/recipient, not
a sequential "call twice") in
`tests/integration/db/notification-service.test.ts`. The loser of the
race catches the `ConflictError` the unique-constraint violation
translates to and returns the winner's row — no caller ever observes a
raw constraint error or a duplicate. See `notification-delivery.md`
"Idempotency, at the delivery layer" for the corresponding
(structurally weaker, and documented as such) statement about
concurrent delivery *processing*.

## Retention

No automatic deletion exists (spec section 21's own instruction: "do
not implement automatic deletion yet unless the existing architecture
specifically requires it — it doesn't"). `Notification.expiresAt` is a
real column, but expiration is a **display concept only** today —
nothing currently reads it to hide or purge a row. `expired` and
`deleted` remain distinct, undocumented-as-implemented states: a
notification is archived by the user (a real, recorded status
transition) or it simply persists. `NotificationDelivery` rows persist
alongside their parent `Notification` for the same reason `AuditEvent`
rows persist — operational/evidentiary value doesn't expire with the
event itself. A future retention job (e.g. "archive notifications older
than N days") is a plausible addition; nothing here blocks it, and
nothing here pretends it already exists.

## Suspended / archived organization, revoked membership

`Notification.organizationId` is association metadata, not an access
gate (see `notifications.md`) — a user's own notification feed remains
visible even if their membership in the associated organization is
later suspended or the organization itself is archived, because
visibility was never conditioned on current membership standing in the
first place; it's conditioned on `recipient_user_id`. This is
deliberate: "you were removed from Org X" is exactly the kind of
notification that must remain readable *after* the removal it describes
— a policy that hid it the moment membership ended would defeat the
notification's own purpose. Membership/authorization state for the
*organization itself* (can this user still act within Org X) is
entirely Module 05/07's own concern, unchanged by this module.

## What was evaluated and deliberately not built

- **Row-level locking on concurrent delivery processing** — see
  `notification-delivery.md`; a real, small gap, acceptable because
  nothing today calls `processDelivery()` concurrently for the same id.
- **Cryptographic tamper-evidence on notification/delivery rows** — not
  evaluated separately from Module 08's own tamper-evidence writeup
  (`audit-security.md` "Tamper evidence"); the same conclusion applies
  and isn't restated here as if it were a new analysis.
- **A `PermissionDeniedError` distinct from `NotFoundError` for
  cross-recipient access** — deliberately not built; see "IDOR" above
  for why indistinguishable-404 is the intended behavior, not a gap.
