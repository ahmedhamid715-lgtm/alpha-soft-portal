# Notification & Communication Infrastructure (Module 09)

Written before implementation, per this module's own mandate — captures
the architectural decisions the code below implements, not a
retrospective summary. See `notification-delivery.md`,
`notification-preferences.md`, `notification-security.md` for the deeper
dives on those three subsystems; this file is the map.

## Core principle

Four *separate* concerns, never collapsed into one table or one
service, per this module's own spec:

1. **Event** — something happened (`OrganizationMembership` removed, an
   ownership transfer completed). Module 01's `events` bus already
   models this; Module 09 adds a subscriber, not a second bus.
2. **Notification** — a message intended for a specific person. What
   they see.
3. **Delivery** — one attempt, on one channel, to get that message to
   that person. What actually happened when the system tried.
4. **Preference** — whether a given category/channel combination is
   even attempted for a given person, evaluated server-side, never
   trusted from the client.

A fifth and sixth concern exist as thin, deliberately-not-over-built
layers on top: **Template** (presentation, code-based, versioned) and
**Provider** (the concrete channel implementation — console today,
a real email API later).

## What was inspected before writing any code

| Existing mechanism | Location | Reused as |
|---|---|---|
| Domain event bus | `lib/platform/events.ts` — `EventBus`/`events` | Directly reused; notification subscriber registered via `events.on()` |
| Email sending | `lib/mail/mailer.ts` — `MailProvider`/`mailer`/`sendXEmail()` | Extended in place into a real `EmailProvider` contract (Section "Email provider abstraction" below) — not replaced, not duplicated |
| Rate limiting | `lib/platform/rate-limit.ts` — `RateLimiter`/`InMemoryRateLimiter` | Directly reused — a new named instance, not a second implementation |
| Tenant context / RLS | `lib/tenancy/context.ts` — `withTenantContext()`, the restricted `alpha_os_app` role | Directly reused for `Notification`/`NotificationDelivery` |
| Authorization | `lib/authorization/authorize.ts` — `requirePermission()` | Directly reused for the two genuinely RBAC-gated surfaces (provider config, cross-org observability) — see "Authorization model" |
| Identity | `lib/auth/session-guard.ts` — `getCurrentUser()` | Directly reused — a user's own notifications/preferences are identity-gated, not permission-gated (see below) |
| Audit | `lib/audit/service.ts` — `audit.recordSuccess/Failure/Denied()` | Directly reused for the actions listed in `notification-security.md` — no second audit system |
| Pagination | `lib/platform/pagination.ts` — `CursorPaginationParams`/`CursorPaginatedResult` | Directly reused for the notification feed, same reasoning Module 08 already established for the audit log ("an audit log or an activity feed" is the pagination module's own named paradigm case for cursor over offset) |
| Design system | `components/ui/*`, `components/shared/*` (`ActivityTimeline`'s hydration-safe relative-time pattern, `EmptyState`, `StatusBadge`, `Pagination`) | Reused; `useRelativeTime` exported from `activity-timeline.tsx` as a small, documented extension rather than duplicated |

## Domain model & ownership classification

Classified the same way Module 06 classified `Organization`/`User`/
`OrganizationMembership` — not "add `organizationId` to everything."

### `Notification` — recipient-owned, organization-*associated*

The real access boundary is **the recipient**, not the organization. A
coworker in the same organization must never see another member's
personal notification feed just by virtue of shared org membership —
that would be a worse leak than anything Module 08's tenant isolation
was built to prevent. `organizationId` is stored (nullable — a security
notification like "your password changed" is pre-tenant/global, exactly
like `AuditEvent.organizationId`'s own reasoning) for grouping,
filtering, and *platform-level* observability, but it is not the SELECT
boundary.

Consequence for RLS: the SELECT policy is keyed on
`recipient_user_id = tenant_current_user_id()`, not on organization
membership — a structurally different shape than every previous
RLS-protected table in this codebase, and worth stating plainly rather
than mechanically reusing the organization-membership pattern where it
doesn't fit.

### `NotificationDelivery` — operational, platform-observable only

No regular user ever queries this table directly — a customer sees
their `Notification` list; delivery internals (attempt counts, provider
responses, retry timing) are an operational concern for platform
staff investigating a failure, gated by the new `notifications.observability`
permission (PLATFORM-scope, mirroring `audit.readPlatform`'s own
reasoning: an operational permission, not an implicit grant of customer
content). RLS SELECT is platform-context-only; there is no per-organization
regular-user read path for this table at all.

### `NotificationPreference` — global identity data, not tenant-owned

Same category as `User`/`UserCredential`/`UserSession` in
`docs/architecture/rls.md`'s own "Tables deliberately without RLS"
section: a person's notification preference is not scoped to any one
organization (a user who belongs to two organizations has one set of
"do I want ticket-activity emails" preferences, not two) and is
protected the same way `updateOwnProfile()` already protects `User`
fields — an identity check (`preference.userId === session.user.id`),
not RLS, not an RBAC permission. Deliberately **not** organization-scoped
— a real simplification, documented here rather than silently assumed:
per-organization preference overrides are a plausible future need, not
built speculatively now.

### `NotificationTemplate` — code, not a table

`lib/notifications/templates.ts` — a typed, versioned registry, the
same `as const satisfies Record<...>` shape `AUDIT_CATALOG` already
established. Not a database table: this module is infrastructure, not a
CMS (spec's own explicit instruction), and a code-based registry is
inherently versioned by git history plus an explicit `version` field
per template, which is what "future changes must not silently rewrite
historical meaning" actually requires — a database row a future admin
UI could edit in place would need MORE machinery (audit-on-every-edit,
a real version table) to make the same guarantee, not less.

### Idempotency — a column, not a table

`Notification.idempotencyKey`, `String @unique`. Spec section 4.5 asks
for structural, not merely application-level, duplicate prevention — a
unique constraint is exactly that: a second `notificationService.notify()`
call with the same key hits a real constraint violation, translated to
the existing `ConflictError`/treated as "already handled," never a
silent second row. No separate `NotificationEvent` join table — a
notification has exactly one originating event, a 1:1 relationship
better represented as columns (`sourceEventType`, `sourceEntityType`,
`sourceEntityId`) than a second table to join every time.

## Authorization model

Two axes, deliberately not collapsed:

1. **Identity** (not RBAC) — a user can always read/mark-read/archive
   their *own* notifications and edit their *own* preferences. This is
   ownership, the same pattern `user-profile-service.ts`'s
   `updateOwnProfile()` already established for `User` fields — no
   `requirePermission()` call, because no role should ever need
   "permission" to read their own inbox.
2. **RBAC** (two new permissions) — for the genuinely privileged
   operations:
   - `notifications.observability` (PLATFORM) — view delivery status/
     failed deliveries/retry state across organizations. Never a grant
     of notification *content* access for a specific customer beyond
     what's needed to diagnose a delivery failure (title, not full body
     — see `notification-security.md`).
   - `notifications.manageProvider` (PLATFORM) — configure/test the
     email provider, send a test notification.

## Event integration

`events.on()`/`events.emit()` (Module 01) are reused verbatim — no
second bus. A notification subscriber module
(`lib/notifications/subscribers.ts`) registers handlers for a small,
real set of *already-emitted* events:

- `MembershipRemoved`, `MembershipStatusChanged` (`membership-service.ts`)
- `OrganizationOwnerChanged` (`role-service.ts` / `ownership-transfer-service.ts`)

These are real, already-shipped Module 07 events — proving the full
`DOMAIN EVENT → NOTIFICATION HANDLER → PREFERENCE EVALUATION →
NOTIFICATION → DELIVERY RECORD` pipeline end to end without inventing
business features this module doesn't own (`ticket.assigned`,
`invoice.paid`, ... remain documented *examples* of the pattern a future
module follows, not implemented here — see "Future-module contract" in
`notification-security.md`).

`events.ts` itself gets one small, additive extension: a documented
`NotificationEventEnvelope` type (organizationId, actorUserId,
entityType, entityId, idempotencyKey, payload) that a future module MAY
use when emitting an event it wants notification handlers to react to
richly — existing `events.emit(name, payload)` call sites are
completely unchanged; nothing about Module 01's bus behavior changes.

## Provider architecture

`lib/mail/mailer.ts`'s existing `MailProvider`/`mailer` singleton is
extended in place — not replaced — into the richer contract this module
needs (accepted/providerMessageId/metadata on success; provider
code/safe message/retryable on failure). `ConsoleEmailProvider` replaces
`ConsoleMailProvider` as the default, still non-production, still
clearly labeled as such in its own log output — exactly the spec's own
requirement ("DO NOT fake production delivery... create a safe
development adapter... clearly identify itself as non-production").
Every existing call site (`sendVerificationEmail`, `sendPasswordResetEmail`,
`sendInvitationEmail`) keeps working unchanged.

`EMAIL_PROVIDER`/`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME` added to
`config/environment.ts` (server-only) and `.env.example` — never a
`NEXT_PUBLIC_*` variable; provider credentials never reach the browser.

## Retry architecture — the queue contract, not a fake queue

No durable background job system exists yet (Module 01's `lib/platform/jobs.ts`
is the same honest "interface now, real backend later" shape this
module follows for delivery processing). `deliveryService.process()` is
written to be safely callable from a future worker/cron/CLI — it does
not run an infinite loop inside a request, and every delivery attempt
records `attemptCount`/`nextAttemptAt`/a terminal failure state. For
this module, synchronous, in-request processing (call `process()`
immediately after queuing) is what actually runs — documented as
exactly that, not dressed up as an async queue.

## What was deliberately not built

- SMS/push channels (interfaces only — `NotificationChannel` is
  implemented by `InAppChannel`/`EmailChannel`; a future `SmsChannel`
  slots in without touching either).
- A durable queue/worker (see "Retry architecture" above).
- A database-backed template CMS.
- Per-organization notification preference overrides.
- Automatic notification/delivery deletion (see `notification-security.md`
  "Retention").
