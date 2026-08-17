# Organization settings

`/organizations/[id]/settings` (Module 07, unchanged by Module 11) —
what's actually there, grouped, with each field's owner/authorization/
persistence/audit behavior. Written for Module 11's own spec section 9,
which asked this to be documented explicitly rather than assumed;
nothing here is new code, this file closes a documentation gap on
already-shipped functionality.

## GENERAL — profile

| Field | Column | Auth | Persistence | Audit |
|---|---|---|---|---|
| Display name | `Organization.displayName` | `organizations.update` | `updateOrganizationProfile()` | `organization.updated` |
| Slug | `Organization.slug` | `organizations.update` | Same, uniqueness re-checked | `organization.updated` |
| Industry/website/country/phone/primary email | `Organization.industry`/`website`/`country`/`phone`/`primaryEmail` | `organizations.update` | Same, one field-level diff | `organization.updated` |
| Logo | `Organization.logoUrl` | `organizations.update` | Same (accepted, no upload UI — see "Branding" below) | `organization.updated` |

One form (`OrganizationProfileForm`), one Server Action, one service
function (`updateOrganizationProfile()`) — every field above is a
column on the SAME row, updated together as whichever subset of fields
the form actually submitted (`organizationRepository.updateProfile()`'s
own partial-update shape); there is no per-field permission split
within "profile."

**Disabled while non-`ACTIVE`** (`disabled={organization.status !==
"ACTIVE"}` — the settings page's own prop, not a second authorization
check): editing a suspended or archived organization's profile is
blocked at the UI layer as a matter of sense, on top of
`resolveOrganizationContext()` already zeroing `organizations.update`
for any non-`ACTIVE` organization at the real authorization layer (spec
section 21) — the UI flag is a courtesy, not the actual boundary.

## LIFECYCLE

Suspend/archive (self-service, `organizations.update`) and reactivate
(platform-only, `organizations.reactivate`) — see
`organization-lifecycle.md` for the full state machine and why
reactivation is platform-exclusive by design, not an oversight.

## OWNERSHIP

Transfer only, owner-only (`ownership.transfer`) — unchanged Module 07
functionality (`ownership-transfer-service.ts`), documented in full in
`organization-management.md`'s own "Ownership transfer" section. Not
duplicated here.

## MEMBERS

Deliberately **not** a settings tab — member management (invite, role
assignment, suspend, remove) lives at `/organizations/[id]/members`
and `/organizations/[id]/invitations`, Module 07's own dedicated
surfaces. Spec section 9's "MEMBERS" category, evaluated: nothing about
member *management* is genuinely a "setting" (a persisted
organization-level preference) — it's a set of mutations on
`OrganizationMembership` rows, already correctly homed elsewhere. Listed
here only to record that this was evaluated, not overlooked.

## SECURITY

Evaluated, not built. No organization-level security setting exists
today (an MFA requirement toggle, an IP allowlist, a session-duration
override) — none of these have a real implementation to expose a
setting FOR; adding a toggle with no enforcement behind it would be
exactly the "invent settings merely to look enterprise" spec section 9
explicitly forbids. A future module implementing any such control adds
its own setting alongside its own enforcement, not a placeholder here
first.

## NOTIFICATIONS

Evaluated, not built as an organization-level settings category.
Module 09's `NotificationPreference` is deliberately **global per-user**,
not organization-scoped (`notification-preferences.md`'s own
established reasoning: "a user who belongs to two organizations has one
set of preferences, not two") — there is no per-organization
notification setting for this settings page to expose. What Module 11
DID add is organization-LIFECYCLE notifications (suspended/reactivated/
archived, fanned out to every active member) — a Module 09 subscriber
addition, not a settings-page addition; see
`organization-security.md` "Notification integration."

## PREFERENCES

Evaluated, not built. `Organization.timezone`/`locale`/`currency`
already exist as real columns (Module 03) but have no dedicated editing
UI yet — a genuine, honest gap, not scope this module claims to close;
adding one is a small, well-contained future addition to
`OrganizationProfileForm`; not built speculatively here.

## Branding (spec section 10)

`Organization.logoUrl` already exists (Module 07) and IS part of the
profile form (a URL field — paste a hosted logo's URL). No file-upload
pipeline exists (`storage.ts`'s Module 01 placeholder has no
implementation yet) — building one is out of this module's scope (spec
section 10's own "do not build a complete white-label platform").
`displayName` already serves as customer-facing identity. No brand
color/favicon/theming fields exist — evaluated and not added: nothing
in the current UI reads or applies a per-organization color, so a
column for one would be exactly the "add a field because it would be
nice" spec section 21 forbids.
