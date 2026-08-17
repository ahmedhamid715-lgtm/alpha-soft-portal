# Audit event catalog

The canonical, single source of truth for every audit action key is
`src/lib/audit/catalog.ts` (`AUDIT_CATALOG`) — this document is a
human-readable index of what's in it as of Module 08, not a second copy
of the data. If this list and `catalog.ts` ever disagree, `catalog.ts`
is correct; update this file to match.

See `docs/architecture/audit-system.md` for the design rationale (naming
convention, why a catalog at all, redaction, transactional consistency).
See `docs/development/auditing.md` for how to add a new event as a
future module.

## Naming convention

Lowercase dot-notation: `resource.action` or
`resource.subresource.action` — e.g. `organization.suspended`,
`organization.member.role_changed`. Deliberately different from
`lib/platform/events.ts`'s own PascalCase domain-event convention (see
audit-system.md "Naming inconsistency, inherited and closed here") — this
catalog is the first canonical, enforced naming authority for *audit*
events specifically.

## Categories

Every action belongs to exactly one `AuditCategory`:
`AUTHENTICATION`, `AUTHORIZATION`, `ORGANIZATION`, `MEMBERSHIP`,
`INVITATION`, `ROLE`, `SECURITY`, `DATA`, `SYSTEM`, `ADMINISTRATION`,
`COMPLIANCE`. Used for filtering in the audit UI and for the query
service's `category` filter — not a taxonomy for anything else.

## Current catalog (as of Module 08)

| Action | Category | Reserved | Description |
|---|---|---|---|
| `auth.login.success` | AUTHENTICATION | | A user successfully signed in. |
| `auth.login.failure` | AUTHENTICATION | | A sign-in attempt failed (wrong credentials, unknown account, or suspended account). |
| `auth.logout` | AUTHENTICATION | | A user signed out. |
| `auth.session.revoked` | AUTHENTICATION | | One or more sessions were revoked (e.g. after a password reset). |
| `security.authorization.denied` | SECURITY | | A permission check denied the request. |
| `security.suspicious_login.denied` | SECURITY | ✅ | A sign-in was denied for a suspicious-activity reason. |
| `role.created` | ROLE | | A custom organization role was created. |
| `role.updated` | ROLE | | A custom organization role's name, description, or permissions were changed. |
| `role.deleted` | ROLE | | A custom organization role was deleted. |
| `organization.created` | ORGANIZATION | | An organization was created. |
| `organization.updated` | ORGANIZATION | | An organization's profile was updated. |
| `organization.suspended` | ORGANIZATION | | An organization was suspended. |
| `organization.reactivated` | ORGANIZATION | | A suspended organization was reactivated. |
| `organization.archived` | ORGANIZATION | | An organization was archived. |
| `organization.owner.transfer_started` | ORGANIZATION | ✅ | Ownership transfer was initiated (reserved for a future two-step flow — today's transfer is a single atomic operation). |
| `organization.owner.transfer_completed` | ORGANIZATION | | Organization ownership was transferred to a different member. |
| `organization.member.invited` | INVITATION | | A person was invited to join an organization. |
| `organization.member.invitation.accepted` | INVITATION | | An invitation was accepted. |
| `organization.member.invitation.revoked` | INVITATION | | A pending invitation was revoked. |
| `organization.member.invitation.resent` | INVITATION | | A pending invitation was resent with a new token. |
| `organization.member.role_changed` | ROLE | | A member's role within an organization was changed. |
| `organization.member.suspended` | MEMBERSHIP | | A member's access to an organization was suspended. |
| `organization.member.reactivated` | MEMBERSHIP | | A suspended member's access was restored. |
| `organization.member.removed` | MEMBERSHIP | | A member was removed from an organization. |
| `profile.updated` | DATA | | A user updated their own profile (name, avatar, timezone, or locale — never credentials or membership). |
| `audit.export.created` | COMPLIANCE | | An audit trail export was generated. |

`reserved: true` entries (`organization.owner.transfer_started`,
`security.suspicious_login.denied`) are named now — so a future module
has a real catalog key to reference — but have no real `audit.record()`
call site yet in this codebase. Same convention `permissions.ts`
established for reserved permissions (`rbac.md` "Reserved permissions").

## Call sites (as of Module 08)

Every place in the codebase that currently calls `audit.recordSuccess()`/
`recordFailure()`/`recordDenied()`, for traceability:

| Action | Call site | Atomic with its mutation? |
|---|---|---|
| `auth.login.success`/`auth.login.failure` | `app/(public)/login/actions.ts` | No (best-effort — see audit-system.md) |
| `auth.logout` | `app/(protected)/actions.ts` | No (best-effort) |
| `auth.session.revoked` | `server/services/password-reset-service.ts` | No (best-effort) |
| `security.authorization.denied` | `lib/authorization/authorize.ts` (`requirePermission()`) | No (best-effort — a denial never opened a mutation transaction) |
| `role.created`/`role.updated`/`role.deleted` | `server/services/role-service.ts` | Yes |
| `organization.member.role_changed` | `server/services/role-service.ts` (`assignRole()`) | Yes |
| `organization.created`/`updated`/`suspended`/`reactivated`/`archived` | `server/services/organization-management-service.ts` | Yes |
| `organization.member.invited`/invitation accepted/revoked/resent | `server/services/invitation-service.ts` | Yes |
| `organization.member.removed`/`suspended`/`reactivated` | `server/services/membership-service.ts` | Yes |
| `organization.owner.transfer_completed` | `server/services/ownership-transfer-service.ts` | Yes |
| `profile.updated` | `server/services/user-profile-service.ts` | No (best-effort, low-sensitivity) |
| `audit.export.created` | `lib/audit/query.ts` (`runExport()`) | No (best-effort — the export itself already succeeded) |
