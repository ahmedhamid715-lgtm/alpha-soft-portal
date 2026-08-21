# Invitation policy (Module 12)

The one real, enforceable governance surface Module 12 adds. See
`organization-governance.md` for how this fits into the module's broader
scope decisions, and `organization-security.md` "Invitation policy
(Module 12)" for the security-specific reasoning (permission split, RLS
proof, adjacent boundaries this module deliberately did not cross).

## Model

`OrganizationInvitationPolicy` (`organization_invitation_policies`) —
1:1 with `Organization`, **lazily created**: no row exists until an
organization customizes at least one field, unlike
`OrganizationOnboarding` (always created at organization-creation time).
`invitationPolicyRepository.findByOrganizationId()` returning `null` is
the normal state for the vast majority of organizations — "use every
documented default," not an error condition.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `requireOwnerForInvitations` | boolean | `false` | When `true`, only the organization's `owner` can send/resend invitations — an ADDITIVE restriction on top of `members.invite` (which `admin` also holds), never a replacement for it. |
| `allowedDomains` | string[] | `[]` (any domain allowed) | Non-empty: an invited email's domain must match one of these exactly. |
| `blockedDomains` | string[] | `[]` (none blocked) | An invited email's domain matching one of these is always rejected, checked BEFORE the allowed list. |
| `invitationExpiryHours` | int | `168` (7 days) | Bounded `1`–`720` (30 days). Applies to invitations created/resent after the policy is set — never retroactive. |

`organization-security-service.ts`'s `getInvitationPolicy()` always
returns a full `InvitationPolicyView` — the row's real values if one
exists, otherwise the table above's defaults — plus `isCustomized:
boolean` so a caller (the UI, a future integration) can distinguish
"explicitly kept at default" from "never configured," without needing
`null`-handling of its own.

## Domain matching (`lib/organizations/domains.ts`)

Canonical form: a bare, lowercase ASCII hostname (`"example.com"`).
`normalizeDomain()` rejects — never silently reinterprets — a full email
address, a URL with a protocol, a path, or wildcard syntax; each
produces a specific, safe-to-display reason. `normalizeDomainList()`
normalizes a whole list, dedupes entries that collapse to the same
canonical domain, and throws on the FIRST invalid entry (never a partial
success with some domains silently dropped).

**Subdomains are never implicitly included.** `"example.com"` in the
list matches `user@example.com` only, never `user@mail.example.com`. An
organization that genuinely needs a subdomain matched lists it
explicitly (`"mail.example.com"`) — one domain, one list entry, one
obvious behavior. See that file's own top comment for the full security
reasoning (an implicit subdomain match is a real, common class of bug:
an org allow-lists a domain trusting only their own corporate zone,
and a subdomain they don't fully control end to end would otherwise
silently pass).

`emailMatchesDomain()` uses the email's LAST `@` to resolve the domain
part (defends against a crafted local-part containing `@`) and compares
case-insensitively.

## Validation (`organization-security-service.ts`, `updateInvitationPolicy()`)

- Every domain in both lists is normalized; the first invalid entry
  rejects the whole update with a specific field error (never a partial
  save).
- A domain present in BOTH `allowedDomains` and `blockedDomains` rejects
  the update — a contradiction, not a "blocked wins" tiebreak worth
  silently resolving; the caller almost certainly made a mistake.
- `invitationExpiryHours` is bounded `1`–`720` by the Zod schema itself
  — an out-of-range value never reaches the database.

## Permissions

`organizations.security.read` (owner + admin, via `ORGANIZATION_FULL`)
/ `organizations.security.update` (owner ONLY). See
`organization-security.md` "Invitation policy (Module 12)" for why the
write permission is deliberately narrower than the read permission —
the self-escalation reasoning is the load-bearing part of this design,
not incidental.

## Enforcement

The ONE real chokepoint: `invitation-service.ts`'s `createInvitation()`
and `resendInvitation()`, both of which look up the organization's
current policy (a `null` row → every default from the table above
applies, i.e. unrestricted) and apply, in order:

1. `requireOwnerForInvitations` — reject unless the caller's own
   membership role is `"owner"`.
2. `blockedDomains` — reject if the invited email's domain matches any
   entry.
3. `allowedDomains` — if non-empty, reject unless the invited email's
   domain matches an entry.
4. `invitationExpiryHours` — used as the new invitation's/resent
   invitation's expiry duration.

`resendInvitation()` re-runs all four against the CURRENT policy, not
the one in effect when the invitation was first created — closing a
"tighten the policy, then resend an old invitation as a back door
around it" gap. Proven by
`tests/integration/db/invitation-service.test.ts`'s own Module 12
section, including that specific regression test.

## Audit & notifications

`organization.invitation_policy.updated` (`AUDIT_CATALOG`) — every
successful `updateInvitationPolicy()` call, with a before/after diff
(`previousState`/`newState`).

`organization.invitation_policy.updated` (event, distinct from but
same-named as the audit action — matches the existing convention every
other lifecycle event/audit-action pair in this codebase already uses)
fans out to the organization's `owner` + `admin` members (never
`member`/`viewer`, who hold neither `organizations.security.read` nor
`members.invite` — a change to this policy is not meaningful information
for them) and never to the actor who made the change themself. Category
`ORGANIZATION_ACTIVITY` (Module 09's existing category), template
`organization.invitation_policy.updated`
(`lib/notifications/templates.ts`).

## RLS

`organization_invitation_policies` is RLS-protected — see
`organization-security.md` "Invitation policy (Module 12)" → "RLS" for
the policy shape and the direct database-level proof
(`organization-invitation-policy-rls.test.ts`).

## UI

`/organizations/[id]/settings` → "Security" section
(`InvitationPolicyForm`) — rendered only when the caller holds
`organizations.security.read`; form controls disabled (with an
explanatory line, not just a silently-inert control) when the caller
lacks `organizations.security.update`. No new route — reuses the
existing settings page, per the module's own instruction not to
duplicate an existing surface.

One implementation note worth recording: React resets a `<form>`'s
UNCONTROLLED fields to their original mount-time defaults after a
successful Server Action (documented React 19 behavior) — without
keying each field on the freshly revalidated policy's own content
(`InvitationPolicyForm`'s `fieldsKey`), a successful save would flash
the switch/textareas/input back to their pre-edit values for a moment.
Found live by this module's own E2E test, not by inspection; fixed by
keying the FIELDS, not the whole form (keying the form itself would also
reset `useActionState`'s own state, losing the success message).
