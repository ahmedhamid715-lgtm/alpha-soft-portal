# Organization governance (Module 12)

What "organization governance" means in Alpha OS, what Module 12 built
under that name, and — just as important — what it explicitly did not,
per the module's own instruction: "Build the correct enterprise
governance architecture for THIS specific application... DO NOT build
every future feature."

## The governance categories, and what happened to each

The spec named five candidate settings categories for this module to
consider. Each was independently evaluated against one test: **is there
a real mechanism in this codebase capable of enforcing it right now?**
If yes, it was built, permission-gated, RLS-protected, audited, and
tested. If no, it was deliberately left out, and that decision is
documented rather than silently skipped.

| Category | Outcome | Where |
|---|---|---|
| GENERAL (profile) | Already existed (Module 07) | `organization-settings.md` "GENERAL" |
| SECURITY (invitation policy) | **Built this module** | `invitation-policy.md`, `organization-security.md` "Invitation policy" |
| MEMBERSHIP GOVERNANCE | Not built — already fully governed | `organization-security.md` "Why membership governance beyond invitations is not modeled" |
| INVITATION GOVERNANCE | **Built this module** (same thing as "SECURITY" above, in this codebase — see below) | `invitation-policy.md` |
| NOTIFICATION GOVERNANCE | Not built — contradicts an existing design decision | `organization-settings.md` "NOTIFICATIONS" |

**Why "SECURITY" and "INVITATION GOVERNANCE" collapsed into one thing.**
The spec listed them as two separate candidate categories. Once actually
designing the enforceable version of each, they turned out to be the
same concept from two angles: the only organization-level "security"
control with a real mechanism behind it (Module 12's own first
principle above) IS the invitation policy — who can invite, from which
domains, for how long a link stays valid. Building two separate
permission namespaces / two separate settings sections for the same
underlying `OrganizationInvitationPolicy` row would have been exactly
the kind of structural duplication the spec's own "prefer a structured
configuration model... do not invent parallel concepts" instruction
warns against. One model, one permission pair, one settings section
("Security," since that's the more accurate name for what it does),
one doc (`invitation-policy.md`) with the full detail.

## Permission namespace — what was actually added, and why not more

The spec suggested a wide candidate namespace:
`organizations.settings.read/update`, `organizations.security.read/update`,
`organizations.membership_policy.read/update`,
`organizations.invitation_policy.read/update`, explicitly asking: "Do
not automatically add every permission above. Determine the minimum
permission set required."

Two were added: `organizations.security.read` / `organizations.security.update`
(see `permissions.ts` for their own doc comments, `roles.ts` for the
owner-only split). The other three candidates were not added:

- `organizations.settings.read/update` — no new capability needs
  gating that `organizations.update` (profile) doesn't already cover;
  adding a second, overlapping permission for the same surface would
  only create ambiguity about which one actually gates what.
- `organizations.membership_policy.read/update` — no membership policy
  exists to gate (see the governance table above); a permission with
  nothing behind it is dead code wearing a security costume.
- `organizations.invitation_policy.read/update` — this is genuinely the
  same concept `organizations.security.read/update` already names; a
  second permission pair for the identical row would be exactly the
  duplication this instruction warns against, not a finer-grained
  boundary.

## Enforcement chokepoint discipline

Every governance control this module builds is enforced at exactly one
place in the code — the same discipline `invitation-service.ts`'s own
top comment establishes for `createInvitation()` (spec's own "single
chokepoint" pattern, already proven out in `role-service.ts`'s
`assignRole()`, `organization-management-service.ts`'s lifecycle
guards). `organization-security-service.ts` OWNS the policy's read/write
path; `invitation-service.ts` CONSULTS it, at its own two write
entrypoints (`createInvitation()`, `resendInvitation()`) — there is no
third path capable of creating or extending an invitation that skips
this check, because no such path exists in the codebase at all.

## See also

- `invitation-policy.md` — the full model: fields, defaults, domain
  matching rules, validation, lifecycle.
- `organization-security.md` "Invitation policy (Module 12)" — the
  security-specific reasoning: permission split, RLS proof, the
  session/membership/notification governance boundaries.
- `organization-settings.md` "SECURITY" — where this fits into the
  broader settings-page inventory.
