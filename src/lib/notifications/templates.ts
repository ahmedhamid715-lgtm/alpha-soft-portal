import type { NotificationSeverity } from "@/generated/prisma/client";
import type { NotificationCategoryKey } from "./categories";

/**
 * The code-based, versioned template registry (spec section 4.4) —
 * NOT a database table. See `docs/architecture/notifications.md`
 * "NotificationTemplate — code, not a table" for why: this module is
 * infrastructure, not a CMS, and a code registry is inherently versioned
 * by git history plus this file's own explicit `version` field, which is
 * what "future changes must not silently rewrite historical meaning"
 * (spec's own requirement) actually needs.
 *
 * A template key is distinct from a `NotificationCategoryKey` — category
 * decides which PREFERENCE bucket governs delivery; a template decides
 * the actual title/body text for one specific kind of event. Several
 * templates commonly share one category (both `membership.removed` and
 * `membership.suspended` are `ORGANIZATION_ACTIVITY`).
 */
export interface NotificationTemplateDefinition<TData> {
  version: number;
  /** An inactive template is a documented no-op guard, not a real state any current call site produces — see `active` check in `lib/notifications/service.ts`. Exists so a future template can be retired without deleting the historical key (old notifications referencing it must remain renderable/understandable in the audit trail even if nothing creates new ones). */
  active: boolean;
  category: NotificationCategoryKey;
  severity: NotificationSeverity;
  render(data: TData): { title: string; body: string; actionUrl?: string };
}

function template<TData>(def: NotificationTemplateDefinition<TData>): NotificationTemplateDefinition<TData> {
  return def;
}

export const NOTIFICATION_TEMPLATES = {
  /// Reacts to `PasswordResetCompleted` (`password-reset-service.ts`) —
  /// a real, already-shipped Module 04 flow, not a synthetic example.
  "account.password_reset": template({
    version: 1,
    active: true,
    category: "ACCOUNT_SECURITY",
    severity: "CRITICAL",
    render: () => ({
      title: "Your password was changed",
      body: "Your Alpha OS password was just changed and every other active session was signed out. If this wasn't you, reset your password immediately.",
      actionUrl: "/settings/account",
    }),
  }),

  /// Reacts to `MembershipRemoved` (`membership-service.ts`).
  "membership.removed": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "WARNING",
    render: (data: { organizationName: string }) => ({
      title: "Removed from organization",
      body: `You were removed from ${data.organizationName}. You no longer have access to its data.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `MembershipStatusChanged` (`membership-service.ts`), status = SUSPENDED.
  "membership.suspended": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "WARNING",
    render: (data: { organizationName: string }) => ({
      title: "Access suspended",
      body: `Your access to ${data.organizationName} was suspended by an administrator.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `MembershipStatusChanged`, status = ACTIVE (reactivation).
  "membership.reactivated": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    render: (data: { organizationName: string }) => ({
      title: "Access restored",
      body: `Your access to ${data.organizationName} was restored.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `OrganizationOwnerChanged` — the OUTGOING owner's copy.
  "ownership.transferred_from": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    render: (data: { organizationName: string; newOwnerName: string }) => ({
      title: "Ownership transferred",
      body: `You transferred ownership of ${data.organizationName} to ${data.newOwnerName}. Your role is now Administrator.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `OrganizationOwnerChanged` — the INCOMING owner's copy.
  "ownership.transferred_to": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    render: (data: { organizationName: string }) => ({
      title: "You are now the owner",
      body: `You are now the owner of ${data.organizationName}.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Module 11 — reacts to `organization.suspended`
  /// (`organization-management-service.ts`). One copy per ACTIVE member
  /// — see `lib/notifications/subscribers.ts`'s own handler for why this
  /// is a whole-organization fan-out, unlike every other Module 09
  /// subscriber, which already has a single known recipient in its event
  /// payload.
  "organization.suspended": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "CRITICAL",
    render: (data: { organizationName: string }) => ({
      title: "Organization suspended",
      body: `${data.organizationName} was suspended by platform staff. You and every other member have lost access until it's reactivated.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `organization.reactivated`.
  "organization.reactivated": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    render: (data: { organizationName: string }) => ({
      title: "Organization reactivated",
      body: `${data.organizationName} was reactivated. Access has been restored.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `organization.archived`.
  "organization.archived": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "WARNING",
    render: (data: { organizationName: string }) => ({
      title: "Organization archived",
      body: `${data.organizationName} has been archived and is no longer active. Your historical access and data are preserved.`,
      actionUrl: "/organizations",
    }),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as const satisfies Record<string, NotificationTemplateDefinition<any>>;

export type NotificationTemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

export function isNotificationTemplateKey(value: string): value is NotificationTemplateKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TEMPLATES, value);
}

export function getNotificationTemplate(key: NotificationTemplateKey): (typeof NOTIFICATION_TEMPLATES)[NotificationTemplateKey] {
  return NOTIFICATION_TEMPLATES[key];
}
