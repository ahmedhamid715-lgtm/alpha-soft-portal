# Notification preferences — policy, storage, UI

The deep dive on the `NotificationPreference` half of Module 09, and the
policy engine that evaluates it. See `notifications.md` for why this
table has no RLS and no `organizationId` at all.

## The two-axis model

A preference is never a single on/off switch for "notifications" — it's
always a **(category, channel)** pair. `TICKET_ACTIVITY` email and
`TICKET_ACTIVITY` in-app are independent decisions; so are
`TICKET_ACTIVITY` email and `BILLING` email. `NotificationPreference`'s
own unique constraint (`userId, category, channel`) is exactly this
pair, and `notificationPreferenceRepository.upsert()` is the only write
path — a user changing a toggle twice updates one row, never creates a
second.

## Category registry — code, not a database table

`lib/notifications/categories.ts` — `NOTIFICATION_CATEGORIES`, the same
`as const satisfies Record<...>` shape `AUDIT_CATALOG` established.
`Notification.category` is a plain string column specifically so a
future module adds a category here, never a migration. Four categories
ship with this module (spec's own explicit examples, not invented
ones):

| Category | Group | Channels | Mandatory | Default |
|---|---|---|---|---|
| `ACCOUNT_SECURITY` | Security | IN_APP, EMAIL | **both** | both on |
| `ORGANIZATION_ACTIVITY` | Organization | IN_APP, EMAIL | IN_APP | both on |
| `SYSTEM` | System | IN_APP | IN_APP | on |
| `MARKETING` | Marketing | IN_APP, EMAIL | IN_APP | IN_APP on, EMAIL **off** |

`ORGANIZATION_ACTIVITY` and `ACCOUNT_SECURITY` are real, wired
categories — `lib/notifications/subscribers.ts` reacts to actual
Module 07 events (`MembershipRemoved`, `MembershipStatusChanged`,
`ownership.transferred`) and the actual Module 04 `PasswordResetCompleted`
event. `SYSTEM` and `MARKETING` have no real sender yet (no announcement
system, no marketing module) — they're seeded so the policy engine and
preferences UI have a genuine "in-app-only, mandatory" case and a
genuine "fully optional extra channel, default off" case to evaluate
against, not placeholders standing in for something unbuilt. A future
module adds its own category (`TICKET_ACTIVITY`, `BILLING`, ...) to this
same registry.

Every category supports and mandates `IN_APP` — a created `Notification`
is always visible in the recipient's own feed; only the *extra* channels
(email, future SMS/push) vary by category and preference.

## Mandatory vs. optional — where it's enforced

**Once, in `lib/notifications/policy.ts:resolveChannels()`** — not
independently re-decided by the database schema and the UI. A mandatory
channel is included in the resolved delivery set unconditionally; the
stored preference row is never consulted for it, even if that row
explicitly says `enabled: false`. This was a deliberate design choice
over the alternative (refuse to let a mandatory-channel preference row
exist at all): one authority is simpler to reason about and audit than
two that must independently agree.

The same rule is enforced **again**, defense-in-depth, at the write
path: `notificationService.updatePreference()` rejects (`ValidationError`)
any attempt to set `enabled: false` on a mandatory category/channel
combination before the row is ever written — see
`lib/notifications/service.ts`. This means a mandatory preference row,
if it exists at all, can only ever say `enabled: true`; `resolveChannels()`'s
own "ignore the stored value for mandatory channels" behavior is
belt-and-suspenders on top of that, not the only line of defense.

`lib/notifications/policy.ts:isChannelMandatory()` is the single
function both the service layer and the `/settings/notifications` page
call to decide "toggle or locked badge" — the UI never computes this
independently (spec section 13: "server-side enforcement must match the
UI" — this is *why* it matches: there's only one implementation).

## What an unset preference means

No row at all for a given (user, category, channel) is not an error —
it means "use the category's own `defaultEnabled` for this channel,"
resolved fresh on every `resolveChannels()` call
(`lib/notifications/policy.ts`) and rendered the same way by
`/settings/notifications` (`getNotificationCategoryDefinition(key).defaultEnabled`).
A brand-new user has zero `NotificationPreference` rows and still gets
category-appropriate defaults from day one — no seed/backfill job
required when a new category ships.

## Ownership and authorization — identity, not RBAC, not RLS

`NotificationPreference` has **no RLS policy at all** and **no
`organizationId` column** — see `notifications.md`'s own classification:
same category as `User`/`UserCredential`/`UserSession` in
`rls.md`'s "Tables deliberately without RLS." A person's notification
preferences aren't scoped to any one organization (someone in two
organizations has one set of "do I want ticket-activity emails"
preferences, not two).

Protection is an ordinary service-layer ownership check —
`notificationPreferenceRepository` is always called with the caller's
own `userId`, resolved from `getCurrentUser()` inside
`notificationService.updatePreference()`/`listPreferences()`, never
accepted as a request parameter. There is structurally no way to pass
"whose preferences" as an argument — the same pattern
`user-profile-service.ts`'s `updateOwnProfile()` already established
for `User` fields. This is deliberately **not** an RBAC permission check
(spec section 13's own instruction: "no role should ever need
permission to control their own preferences") and deliberately not RLS
(a global, not tenant-owned, table has nothing for a Postgres session
variable keyed on organization to scope).

## Rate limiting

`updatePreference()` and `markAllRead()` are both protected by
`notificationRateLimiter` (`lib/platform/rate-limit.ts` — 60 requests
per 5-minute window per `${action}:${userId}`), the same
`InMemoryRateLimiter` class Module 04's auth surface and Module 07's
invitation surface already use, a new instance/key namespace, not a
third implementation. `notify()`/`notifyMany()` (notification
*creation*) are not rate-limited — they're never invoked with
client-controlled frequency (only from server-side event subscribers),
so there's no client request pattern to throttle.

## The preferences UI

`/settings/notifications` — grouped by `category.group` (Security,
Organization, System, Marketing), one card per category, one row per
supported channel. A mandatory channel renders a locked `Required` badge
(`Lock` icon, `Badge` component); an optional channel renders a `Switch`
(`components/notifications/preference-toggle.tsx`) bound to
`updatePreferenceAction`. The page computes "is this mandatory" and
"what's the effective on/off state" using the exact same
`getNotificationCategoryDefinition()`/`defaultEnabled` the server uses —
never a parallel copy of the policy.

## What was deliberately not built

- Per-organization preference overrides (spec's own example of a
  plausible future need, explicitly not built speculatively — see
  `notifications.md` "What was deliberately not built").
- A "mute this specific notification" per-item control, distinct from
  category-level preferences.
- Digest/batching preferences (e.g. "email me a daily summary instead of
  per-event") — every EMAIL delivery today is sent per-notification,
  immediately.
