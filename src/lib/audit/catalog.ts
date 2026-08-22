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

  // --- Organization security & governance (Module 12) ---
  "organization.invitation_policy.updated": action("ORGANIZATION", "An organization's invitation/security governance policy (owner-only invites, allowed/blocked domains, invitation expiry) was changed."),

  // --- Billing (Module 13) — every sensitive billing action produces
  // exactly one of these (spec §30). `billing.payment_method.updated`
  // is `reserved` — Alpha OS never directly observes a raw payment-
  // method change (Stripe's Billing Portal handles the entire flow
  // without a distinct webhook this module consumes; see
  // billing-webhooks.md "Intentionally unsupported events") — seeded so
  // a future module adding real payment-method tracking has a real
  // catalog entry to reference, the same "reserved" convention
  // `permissions.ts` established.
  "billing.account.created": action("BILLING", "An organization's billing account was created."),
  "billing.account.updated": action("BILLING", "An organization's billing account status changed (e.g. suspended, closed)."),
  "billing.subscription.created": action("BILLING", "A subscription was created for an organization."),
  "billing.subscription.updated": action("BILLING", "A subscription's plan, items, or period changed."),
  "billing.subscription.canceled": action("BILLING", "A subscription was canceled (at period end or immediately)."),
  "billing.subscription.resumed": action("BILLING", "A subscription scheduled for cancellation was resumed — Alpha OS's own name for what Module 14's spec calls \"reactivated\"; see subscription-lifecycle.md for why CANCELED→ACTIVE is never the same operation as undoing a still-pending CANCEL_AT_PERIOD_END."),
  // Module 14 — was `reserved: true` in Module 13 (no live call site);
  // now real, from `changeSubscriptionPlan()`'s in-place upgrade/
  // downgrade (never the earlier module's own "always a fresh Checkout
  // Session" path, which would double-subscribe an existing customer —
  // see subscription-lifecycle.md "The in-place change bug Module 13
  // left behind").
  "billing.plan.changed": action("BILLING", "An organization's subscription plan/price changed."),
  "billing.plan.catalog_updated": action("BILLING", "A platform administrator created, edited, or deactivated a plan/price in the catalog."),
  "billing.payment_method.updated": action("BILLING", "An organization's payment method changed.", true),
  "billing.invoice.created": action("BILLING", "An invoice was created."),
  "billing.payment.succeeded": action("BILLING", "A payment succeeded."),
  "billing.payment.failed": action("BILLING", "A payment attempt failed."),
  "billing.refund.created": action("BILLING", "A refund was issued on a payment."),

  // --- Billing operations (Module 14) ---
  "billing.credit.issued": action("BILLING", "A credit was issued to an organization's ledger."),
  "billing.credit.adjusted": action("BILLING", "A compensating (reversal/correction) entry was recorded against an earlier credit ledger entry — never a mutation of the original."),
  "billing.trial.extended": action("BILLING", "A subscription's trial period was extended by platform staff."),
  "billing.payment.retry_requested": action("BILLING", "A retry of a failed invoice payment was requested — records the request; the actual outcome (succeeded/failed again) arrives via the normal invoice.paid/payment_failed webhook, same as every other provider-mediated mutation in this module."),
  "billing.webhook.failed": action("BILLING", "A billing webhook event failed to process (see BillingWebhookEvent.error for the safe, sanitized reason)."),
  // `billing.webhook.processed` is deliberately `reserved` — a
  // SUCCESSFUL webhook's real effect is already captured by whichever
  // specific action it produced (`billing.subscription.updated`,
  // `billing.invoice.created`, `billing.payment.succeeded`, ...); a
  // second, generic "a webhook happened" entry for every one of those
  // would be pure duplication, not a new signal — the same "no audit
  // events for redundant/meaningless entries" restraint Module 09's own
  // catalog comment already documents for mark-read events. Seeded so a
  // future module with a genuine use for a raw processed-count signal
  // has a real key to reference.
  "billing.webhook.processed": action("BILLING", "A billing webhook event was processed (see the specific domain action it produced for the real effect).", true),

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
