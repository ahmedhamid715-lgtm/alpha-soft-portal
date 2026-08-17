# Organization lifecycle

The `Organization.status` state machine (Module 06/07, extended by
Module 11's own guards) — `ACTIVE`/`SUSPENDED`/`ARCHIVED`, no new enum
values. See `organization-management.md` for the surrounding
architecture and `organization-security.md` for the trust model each
transition enforces.

## States and valid transitions

```
ACTIVE ──(suspendOrganization)──> SUSPENDED ──(reactivateOrganization)──> ACTIVE
ACTIVE ──(archiveOrganization)───────────────────────────────────────> ARCHIVED
SUSPENDED ──(archiveOrganization)────────────────────────────────────> ARCHIVED
```

`ARCHIVED` is **terminal** — there is no `ARCHIVED → ACTIVE` transition.
This is a deliberate reading of the existing architecture's own "no
hard delete anywhere — archiving is the only removal an organization
gets" principle: if archival were freely reversible, it would function
as a soft "pause," not the closest thing to removal this system has.
An organization archived in error is a real operational scenario, but
it's handled by a human decision (a platform engineer restoring the row
directly, an audited, deliberate exception) — never a same-shaped
self-service or platform button, because that would make archival mean
the same thing as suspension.

## A real, previously-unguarded gap — now fixed

Before this module, **none of the three lifecycle functions
(`suspendOrganization`/`reactivateOrganization`/`archiveOrganization`)
validated the organization's CURRENT status before transitioning it.**
For `suspendOrganization()`/`archiveOrganization()` this was mostly
academic — `resolveOrganizationContext()` already zeroes
`organizations.update` for ANY non-ACTIVE organization, for every
caller, including one with a genuine membership there (spec section 21)
— so no realistic caller could reach the missing guard anyway. Module
11 added explicit state checks to both regardless, as real defense-in-
depth, proven unreachable-in-practice rather than assumed so (see
`tests/integration/db/organization-management-service.test.ts`).

**`reactivateOrganization()` was different, and genuinely exploitable.**
`organizations.reactivate` is a PLATFORM permission
(`requirePermission("organizations.reactivate")`, no `organizationId`
argument) — resolved via the caller's own platform membership,
completely independent of the target organization's status. Nothing
stopped a platform admin from calling `reactivateOrganization()` on an
`ARCHIVED` organization before this module: it would silently flip
`status` back to `ACTIVE` and clear `archivedAt`
(`organizationRepository.updateStatus()`'s own `ACTIVE` branch), un-
archiving something the state diagram never intended to be reversible.
Found by this module's own reconnaissance (reading the function, not
running it) and fixed with an explicit `before.status !== "SUSPENDED"`
guard — `reactivateOrganization()` now rejects both an `ARCHIVED` target
(`"An archived organization cannot be reactivated through this
action"`) and a redundant call on an already-`ACTIVE` one. Regression
tests: `tests/integration/db/organization-management-service.test.ts`.

## The reactivation reachability gap

A second, independent, and more user-facing gap: **before this module,
platform staff had no reliably reachable UI path to reactivate a
suspended organization they were not themselves a member of** — the
common case, since platform staff generally aren't members of customer
organizations at all (`security.md`'s own platform-vs-tenant boundary).

The only "Reactivate" button in the codebase lived on
`/organizations/{id}/settings`, gated by
`resolveOrganizationContext(id)`. That function requires a real,
`ACTIVE` `OrganizationMembership` row for the caller in THAT specific
organization to resolve any permissions at all — a platform admin with
zero membership there gets an entirely empty permission set, and the
page renders "You don't have access to this page," **even though
that same admin genuinely holds `organizations.reactivate` via their
PLATFORM context** (a completely different resolution,
`resolvePlatformContext()`, that the settings page never consults).

Verified live, not just reasoned about: a real `platform_owner` account
visiting a real suspended organization's settings page saw the denial
screen, with literally no path forward. Fixed by
`/admin/organizations/[id]` (`getOrganizationForPlatform()`,
`resolvePlatformContext()`-gated) — the intended, now-reachable home for
this action. `/organizations/{id}/settings`'s own `LifecycleControls`
component is unchanged; it remains correct for the case it was actually
reachable for (a platform admin who ALSO happens to hold a real
membership in that organization).

## What was deliberately not built

- `ARCHIVED → ACTIVE` as a self-service or platform button — see
  "States and valid transitions" above.
- A generic "any staff member with any permission can flip any status"
  admin control — every transition keeps its own specific permission
  (`organizations.update` for suspend/archive, `organizations.reactivate`
  for reactivate), exactly as Module 07 originally designed it.
- Suspend/archive buttons on `/admin/organizations/[id]` — deliberately
  absent; see that page's own UI copy and
  `organization-security.md` "Why suspend/archive stay self-service-only
  on the platform view."
