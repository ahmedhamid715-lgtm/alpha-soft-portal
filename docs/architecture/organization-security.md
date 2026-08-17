# Organization security & trust model

The honest accounting of what Module 11 guarantees and how each is
proven — same discipline `audit-security.md`/`user-security.md` already
established. Module 11 is additive on top of Module 06/07's own
extensive, already-tested security model (`multi-tenancy.md`,
`organization-management.md`'s own "Security boundary" section); this
file covers what Module 11 itself adds or verifies, not a restatement
of everything those already prove.

## Trust boundaries — never client-supplied

- **The platform organization** — `organizationRepository.findPlatformOrganization()`,
  never a client `organizationId`. `isPlatform` cannot be set through
  any mutation path this module (or any prior one) exposes — there is
  no `isPlatform` field on `updateOrganizationProfile()`'s schema, and
  the database enforces at most one `isPlatform = true` row at all
  (`organizations_single_platform_org`, a real unique index, not just
  service-layer discipline).
- **The acting caller's identity/permissions** — every Module 11
  function resolves them via `requirePermission()`, never a request
  parameter.
- **Lifecycle transitions** — `suspendOrganization()`/
  `reactivateOrganization()`/`archiveOrganization()` all re-derive the
  target organization's CURRENT status from the database immediately
  before transitioning it (see `organization-lifecycle.md`'s new
  guards) — never trusted from a client's assumption of what state it's
  currently in.

## RLS — `Organization` itself vs. everything that references it

`organizations` has **no RLS policies at all** — confirmed directly
against the real database (`select * from pg_policies where
tablename='organizations'` returns zero rows). This is correct, not a
gap, and worth documenting explicitly since no prior module's docs
stated it outright: the row-level-security model filters by "the
current tenant context's organization," but a user can belong to
MULTIPLE organizations and legitimately needs to see all of them (the
`/organizations` switcher lists every organization a caller belongs to,
by design) — an RLS policy keyed on "the current tenant context" would
break that exact, legitimate query. The REAL access boundary for a
specific `Organization` row is "does the caller have a real, ACTIVE
membership in it" (or hold a PLATFORM permission), checked at the
APPLICATION layer (`resolveOrganizationContext()`/`resolvePlatformContext()`),
not a per-row Postgres session variable.

**What IS RLS-protected**: `organization_memberships` (Module 06's own
core protected table), which this module's new
`getOrganizationForPlatform()` reads. That function goes through
`withTenantContext({ isPlatformStaff: true, ... })` for those reads —
RLS's platform-context bypass is what grants visibility, not the plain,
unrestricted `db` client — making the permission check a real second
line of defense, not the only one. (`organizationRepository.search()`/
`list()`/`findBySlug()`/`findPlatformOrganization()` read `organizations`
itself directly, correctly, per the "no RLS on this table" reasoning
above — same established pattern every prior module already uses for
this exact table.)

## What platform staff can and cannot see

`organizations.read` (PLATFORM) grants the directory
(`listOrganizationsForPlatform()`) and per-organization view
(`getOrganizationForPlatform()`) — deliberately narrow:

- Organization identity, status, timestamps — always visible.
- Current owner's name/email — visible (useful for support triage; the
  same class of information Module 10's own user directory already
  exposes to `users.read`-holding platform staff).
- A bounded membership-status COUNT — visible.
- **The full member roster (names, emails, roles of every member) —
  NEVER shown here.** That stays at `/organizations/{id}/members`,
  gated by THAT organization's own `members.read`, which platform staff
  don't automatically hold. Re-implementing a member list on the
  platform view would be exactly the "a platform role must not
  automatically grant access to every customer organization's private
  information" spec section 1 explicitly forbids.
- **That organization's own audit trail — NEVER shown here.**
  `audit.readPlatform` already cannot substitute for a specific
  organization's own `audit.read` (`audit-security.md`'s own
  established rule); `getOrganizationForPlatform()` doesn't query
  `AuditEvent` at all, so there's no path for this leak to even be
  attempted. An admin who genuinely needs that organization's own
  activity follows the (unbuilt, deliberately deferred) link to that
  organization's own `/organizations/{id}/audit`, where the real,
  independently-gated `audit.read` check applies.

## Why suspend/archive stay self-service-only on the platform view

`/admin/organizations/[id]` offers exactly one lifecycle action:
reactivate. Suspend/archive are NOT offered there, even though a
platform admin conceptually "could" want to suspend a customer
organization for cause. This is deliberate: `organizations.update` is
ORGANIZATION-scoped, and platform staff don't hold it for an
organization they aren't a member of (the same boundary that caused
the reactivation reachability gap `organization-lifecycle.md` documents
— but here, correctly, there's no bug to fix, because suspend/archive
were never SUPPOSED to be reachable this way). Offering a button that
would just throw `AuthorizationError` for the common case is worse UX
than omitting it — and if platform-initiated suspension-for-cause is a
genuine future need, it deserves its own explicit, narrower permission
(the same `ownership.transfer`/`organizations.reactivate` precedent),
not a silent broadening of `organizations.update`'s own meaning.

## Audit integration

No new catalog entries — `organization.created`/`updated`/`suspended`/
`reactivated`/`archived` all already existed (Module 07). Every
Module 11 mutation (the reactivation guard rejections, the platform
directory reads) either reuses those exactly or performs no mutation at
all (`listOrganizationsForPlatform()`/`getOrganizationForPlatform()`
are pure reads — not audited, the same "no audit events for plain
reads" discipline every other module here follows).

## Notification integration

New: `organization.suspended`/`organization.reactivated`/
`organization.archived` subscribers (`lib/notifications/subscribers.ts`)
— reacting to the SAME `events.emit()` calls those three service
functions already made (Module 07 shipped the emit; Module 09 had no
subscriber registered for them yet, so they were previously a
documented no-op). Fan-out to every ACTIVE member via
`notificationService.notifyMany()`, category `ORGANIZATION_ACTIVITY`
(Module 09's existing category, IN_APP mandatory, EMAIL optional
default-on — unchanged). A `SUSPENDED` member is deliberately excluded
from the fan-out — they already have zero access and zero reason to be
notified about a change to an organization they can't currently act
within; an `ACTIVE` member who joined moments before the transition
correctly receives it. Proven in
`tests/integration/db/organization-management-service.test.ts`.

**Not built**: notifications for `organization.updated` (profile
edits) — evaluated and judged too noisy (a profile field edit is not
the kind of access-changing event `ORGANIZATION_ACTIVITY`'s own
mandatory-IN_APP policy is meant for); a future module can add a
lighter-weight, non-mandatory category for this if a real need
emerges.

## The 30 adversarial questions (spec section 24)

1. Can Organization A access Organization B? — No; `organizations` has
   no RLS (see above), so access is entirely the application-layer
   membership/permission check, proven not to cross organizations by
   Module 06/07's own extensive existing test suite (`multi-tenancy.spec.ts`,
   `user-org-management.spec.ts`), re-run clean by this module.
2. Can a forged `organizationId` switch a user into another
   organization? — No; unchanged Module 06 guarantee
   (`switchOrganizationAction`/`resolveOrganizationContext()`'s own
   real membership re-check), re-verified passing.
3. Can a forged slug expose another organization? — Slug is a lookup
   key, not an authorization token; every organization-scoped read
   still goes through `resolveOrganizationContext()`'s own membership
   check regardless of how the id/slug was obtained.
4–5. Can a suspended/archived organization continue accessing tenant
   resources? — No; unchanged Module 06 guarantee
   (`resolveOrganizationContext()` zeroes permissions for any
   non-`ACTIVE` organization), re-verified passing
   (`multi-tenancy.spec.ts`).
6. Can a revoked membership continue accessing the organization? —
   Unchanged Module 07 guarantee, re-verified passing.
7–9. Ownership forgery/unauthorized transfer — unchanged
   `ownership-transfer-service.ts`, not touched by this module; its own
   existing adversarial tests continue to pass.
10. Can two concurrent ownership transfers corrupt ownership state? —
    Unchanged `SELECT ... FOR UPDATE` row-locking, not touched by this
    module.
11. Can the last owner be removed? — Unchanged `wouldRemoveLastOwner()`,
    not touched by this module.
12. Can an organization owner assign themselves a platform role? — No;
    `assignRole()` (Module 05) rejects a PLATFORM-scope role outside
    the platform organization — unchanged, unrelated to this module.
13–14. Can a customer create a platform organization / set
   `isPlatform=true`? — No; `organizations.create` is PLATFORM-scope
   only, and no mutation path (old or new) accepts `isPlatform` as
   input at all.
15. Can a platform organization be duplicated? — No; a real database
    unique index prevents it (see "Trust boundaries" above).
16. Can platform staff accidentally access customer-private resources?
    — This is what "What platform staff can and cannot see" above
    exists to prevent — the one adversarial question this module's own
    design most directly targets, the same way Module 10's activity-
    scoping targeted its analogous question.
17. Can customer users access platform-private resources? — No;
    `resolvePlatformContext()` only ever resolves a real membership in
    the one `isPlatform` organization; a customer org's own membership
    grants nothing there.
18. Can organization settings be modified through direct Server Action
    invocation? — No differently than through the UI — every Server
    Action calls the same permission-checked service function; there is
    no separate, less-checked path (spec's own "never trust the UI as a
    security boundary" — proven structurally, not just by not building
    a bypass).
19. Can `organizationId` be manipulated in a hidden form field? — No;
    every mutation re-derives authorization from the SUBMITTED
    `organizationId` independently via `requirePermission(...,
    organizationId)`, which re-checks real membership — a forged id
    for an organization the caller doesn't belong to fails there,
    regardless of what the hidden field said.
20. Can browser back-navigation restore access to a suspended org? —
    No; unchanged Module 06 guarantee (every authoritative request
    re-resolves context server-side; nothing is cached client-side)
    re-verified passing (`multi-tenancy.spec.ts`'s own dedicated test).
21. Can a stale selection cookie bypass membership validation? — No;
    `getSelectedOrganizationId()`'s cookie is a hint only,
    independently re-validated by `resolveOrganizationContext()`'s own
    real membership lookup every time — unchanged, re-verified passing.
22. Can a notification leak another organization's information? — No;
    the new lifecycle-notification templates interpolate only
    `organizationName` for the organization the event is actually
    about, sent only to that organization's own active members
    (verified via `notifyMany()`'s per-recipient `organizationId`/
    `idempotencyKey`).
23. Can an audit detail page leak another organization's events? —
    Unchanged Module 08 guarantee, not touched by this module.
24. Can a cross-tenant search reveal organization names? — The platform
    directory's search is intentionally platform-WIDE (spec section 1's
    own instruction — this is not a "search must never become global"
    violation the way a CUSTOMER-facing search would be; it's gated by
    `organizations.read`, PLATFORM-scope, exactly the audience this
    view is for).
25. Can concurrent slug creation bypass uniqueness? — No; the database
    `slug` column has a real `UNIQUE` constraint
    (`Organization.slug @unique`) as the structural guarantee behind
    the application-level pre-check, unchanged from Module 07.
26. Can an archived organization be reactivated by an unauthorized
    user? — No (permission-gated, unchanged) — AND, as of this module,
    not even by an AUTHORIZED one (see `organization-lifecycle.md`'s
    real, previously-unguarded gap and its fix).
27. Can organization lifecycle permissions be bypassed? — No; every
    transition independently calls `requirePermission()` — proven via
    this module's own new escalation test
    (`suspendOrganization()`/`archiveOrganization()`'s state guards are
    unreachable through the normal permission path — see that test's
    own title for why that's a genuinely stronger finding than "denied
    by a permission check" alone).
28. Can organization data be accessed without tenant context? — For
    `organization_memberships` (the RLS-protected table): no,
    `withTenantContext()` fails closed with no context set (Module 06's
    own proven guarantee). For `organizations` itself: correctly not
    tenant-context-scoped at all — see "RLS" above for why that's the
    right shape, not a gap.
29. Can an RLS query with no WHERE clause expose another tenant? —
    Unchanged Module 06 guarantee for every RLS-protected table,
    re-verified passing (`tests/integration/db/rls.test.ts`).
30. Can a compromised client-controlled identifier cross the tenant
    boundary? — Every identifier this module's own functions accept
    (`organizationId`) is independently re-verified against a real
    permission/membership check before use — proven throughout
    `tests/integration/db/organization-management-service.test.ts`'s
    own cross-tenant IDOR tests (pre-existing and new).

## What was evaluated and deliberately not built

- Organization-level security settings — see `organization-settings.md`
  "SECURITY."
- A platform-initiated suspend/archive action — see "Why suspend/
  archive stay self-service-only on the platform view" above.
- Notifications for profile-update events — see "Notification
  integration" above.
- `ARCHIVED → ACTIVE` reversal through any UI or service path — see
  `organization-lifecycle.md` "States and valid transitions."
