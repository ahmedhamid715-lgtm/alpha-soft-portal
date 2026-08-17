/**
 * The canonical audit event catalog (Module 08, spec Phase 3) — the
 * single source of truth for every audit action key that exists in
 * Alpha OS. Nothing else hand-types an action string: `audit.record()`
 * (`service.ts`) requires a key from this catalog, the audit UI's
 * category filter and event-detail human-readable line
 * (`describeEvent()`, `query.ts`) both read FROM it.
 *
 * Naming convention: lowercase dot-notation, `resource.action` or
 * `resource.subresource.action` — `organization.member.role_changed`,
 * not `MemberRoleChanged` or `member_role_changed`. This is deliberately
 * different from `lib/platform/events.ts`'s own PascalCase convention
 * (`RoleCreated`) — see `docs/architecture/audit-system.md` "Naming
 * inconsistency, inherited and closed here" for why: this catalog is the
 * first canonical, enforced naming authority for *audit* events
 * specifically; it does not rename any existing `events.emit()` call.
 *
 * Every future module extends this object — it never hand-invents a
 * parallel action string. See `docs/development/auditing.md`.
 */
import type { AuditCategory } from "@/generated/prisma/client";

export interface AuditActionDefinition {
  category: AuditCategory;
  /** One sentence, for the audit UI's category legend and this file's own documentation — not shown per-event (see `describeEvent()` in `query.ts` for the per-event human-readable line). */
  description: string;
  /**
   * True for an action this module names now but has no real call site
   * for yet — same "reserved" convention `permissions.ts` established
   * (spec section 8's own precedent): a future two-phase ownership
   * transfer, a future explicit "suspicious login" detector. Seeded so a
   * future module has a real catalog entry to reference, never the
   * subject of an actual `audit.record()` call in this module's code.
   */
  reserved?: boolean;
}

function action(category: AuditCategory, description: string, reserved = false): AuditActionDefinition {
  return { category, description, reserved };
}

export const AUDIT_CATALOG = {
  // --- Authentication (Module 04) ---
  "auth.login.success": action("AUTHENTICATION", "A user successfully signed in."),
  "auth.login.failure": action("AUTHENTICATION", "A sign-in attempt failed (wrong credentials, unknown account, or suspended account)."),
  "auth.logout": action("AUTHENTICATION", "A user signed out."),
  "auth.session.revoked": action("AUTHENTICATION", "One or more sessions were revoked (e.g. after a password reset)."),

  // --- Authorization (Module 05) ---
  "security.authorization.denied": action("SECURITY", "A permission check denied the request."),
  "security.suspicious_login.denied": action("SECURITY", "A sign-in was denied for a suspicious-activity reason.", true),

  // --- Roles (Module 05) ---
  "role.created": action("ROLE", "A custom organization role was created."),
  "role.updated": action("ROLE", "A custom organization role's name, description, or permissions were changed."),
  "role.deleted": action("ROLE", "A custom organization role was deleted."),

  // --- Organizations (Module 07) ---
  "organization.created": action("ORGANIZATION", "An organization was created."),
  "organization.updated": action("ORGANIZATION", "An organization's profile was updated."),
  "organization.suspended": action("ORGANIZATION", "An organization was suspended."),
  "organization.reactivated": action("ORGANIZATION", "A suspended organization was reactivated."),
  "organization.archived": action("ORGANIZATION", "An organization was archived."),

  // --- Ownership (Module 07) ---
  "organization.owner.transfer_started": action("ORGANIZATION", "Ownership transfer was initiated (reserved for a future two-step transfer flow — today's transfer is a single atomic operation, see organization.owner.transfer_completed).", true),
  "organization.owner.transfer_completed": action("ORGANIZATION", "Organization ownership was transferred to a different member."),

  // --- Invitations (Module 07) ---
  "organization.member.invited": action("INVITATION", "A person was invited to join an organization."),
  "organization.member.invitation.accepted": action("INVITATION", "An invitation was accepted."),
  "organization.member.invitation.revoked": action("INVITATION", "A pending invitation was revoked."),
  "organization.member.invitation.resent": action("INVITATION", "A pending invitation was resent with a new token."),

  // --- Membership lifecycle (Module 07) ---
  "organization.member.role_changed": action("ROLE", "A member's role within an organization was changed."),
  "organization.member.suspended": action("MEMBERSHIP", "A member's access to an organization was suspended."),
  "organization.member.reactivated": action("MEMBERSHIP", "A suspended member's access was restored."),
  "organization.member.removed": action("MEMBERSHIP", "A member was removed from an organization."),

  // --- Profile (Module 07) ---
  "profile.updated": action("DATA", "A user updated their own profile (name, avatar, timezone, or locale — never credentials or membership)."),

  // --- User management (Module 10) — administrative actions platform
  // staff take on ANOTHER person's global `User` record, distinct from
  // `profile.updated` (self-service, Module 07) and from
  // `organization.member.*` (membership-scoped, one organization).
  // `ADMINISTRATION`, matching the same category `notification.*.changed`
  // already uses for platform-staff-on-someone-else's-account actions.
  "user.created": action("ADMINISTRATION", "Platform staff created a new platform user record."),
  "user.updated": action("ADMINISTRATION", "Platform staff edited another user's profile."),
  "user.suspended": action("ADMINISTRATION", "Platform staff suspended a user's global account."),
  "user.reactivated": action("ADMINISTRATION", "Platform staff reactivated a suspended or deactivated user's global account."),
  "user.deactivated": action("ADMINISTRATION", "Platform staff deactivated a user's global account (never a hard delete — see data-modeling.md)."),

  // --- Compliance / this module's own actions ---
  "audit.export.created": action("COMPLIANCE", "An audit trail export was generated."),

  // --- Notifications (Module 09) — deliberately NOT auditing every
  // mark-read/mark-unread (noise — the same "no audit events for
  // meaningless UI interactions" discipline this module already applies
  // elsewhere; see docs/architecture/notification-security.md "What's
  // audited, and what isn't"). Reuses DATA/SYSTEM/ADMINISTRATION rather
  // than adding a new AuditCategory enum value for one module's four
  // actions — same restraint this catalog already applies to indexes
  // and tamper-evidence: don't add structure without a concrete need.
  "notification.archived": action("DATA", "A user archived one of their own notifications."),
  "notification.preference.updated": action("DATA", "A user changed a notification preference."),
  "notification.delivery.failed": action("SYSTEM", "A notification delivery attempt reached a terminal failure state."),
  "notification.test.sent": action("ADMINISTRATION", "Platform staff sent a test notification to verify provider configuration."),
  "notification.provider.changed": action("ADMINISTRATION", "The configured email provider was changed.", true),
} as const satisfies Record<string, AuditActionDefinition>;

export type AuditActionKey = keyof typeof AUDIT_CATALOG;

export function isAuditActionKey(value: string): value is AuditActionKey {
  // `Object.prototype.hasOwnProperty`, not `value in AUDIT_CATALOG` — `in`
  // also matches inherited `Object.prototype` properties ("toString",
  // "constructor", "hasOwnProperty" itself), which would make this
  // function wrongly return `true` for those strings. Found by this
  // module's own test suite, not by inspection — see
  // `catalog.test.ts`'s "no accidental Object.prototype leak" case. Same
  // safe-lookup pattern `roles.ts`'s `isSystemRoleKey()` already uses.
  return Object.prototype.hasOwnProperty.call(AUDIT_CATALOG, value);
}

export function getAuditActionDefinition(key: AuditActionKey): AuditActionDefinition {
  return AUDIT_CATALOG[key];
}
