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

  /// Module 13 — reacts to `billing.subscription.created`
  /// (`billing-webhook-service.ts`, confirmed by Stripe, never the
  /// user-initiated checkout request itself — see that service's own
  /// top comment on why).
  "billing.subscription.created": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "INFO",
    render: (data: { organizationName: string; planName: string }) => ({
      title: "Subscription active",
      body: `${data.organizationName}'s subscription to ${data.planName} is now active.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.subscription.updated` when the transition is
  /// TO `PAST_DUE` specifically — see `subscribers.ts`'s own filter for
  /// why not every raw `customer.subscription.updated` webhook (which
  /// fires on routine period renewals too) reaches this template.
  "billing.subscription.past_due": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "WARNING",
    render: (data: { organizationName: string }) => ({
      title: "Payment past due",
      body: `${data.organizationName}'s most recent payment failed. Update the payment method to avoid a service interruption.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.subscription.updated` when the transition is TO
  /// `CANCELED` (the webhook-confirmed cancellation, not the moment a
  /// cancel-at-period-end request was merely submitted).
  "billing.subscription.canceled": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "WARNING",
    render: (data: { organizationName: string }) => ({
      title: "Subscription canceled",
      body: `${data.organizationName}'s subscription has ended.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.invoice.created`.
  "billing.invoice.created": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "INFO",
    render: (data: { organizationName: string; invoiceNumber: string }) => ({
      title: "New invoice available",
      body: `Invoice ${data.invoiceNumber} is available for ${data.organizationName}.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.payment.succeeded` (both the invoice-driven and
  /// direct-PaymentIntent paths — see `billing-webhook-service.ts`).
  "billing.payment.succeeded": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "INFO",
    render: (data: { organizationName: string }) => ({
      title: "Payment received",
      body: `A payment for ${data.organizationName} was processed successfully.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.payment.failed`.
  "billing.payment.failed": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "CRITICAL",
    render: (data: { organizationName: string }) => ({
      title: "Payment failed",
      body: `A payment for ${data.organizationName} could not be processed. Update the payment method to avoid a service interruption.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Module 14 — reacts to `customer.subscription.trial_will_end`
  /// (Stripe's own 3-day-out signal, see `billing-webhook-service.ts`).
  "billing.trial.ending": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "WARNING",
    render: (data: { organizationName: string }) => ({
      title: "Trial ending soon",
      body: `${data.organizationName}'s trial ends in a few days. Add a payment method to continue without interruption.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.subscription.updated` transitioning OUT of
  /// TRIALING (converted to paid, or lapsed) — see `subscribers.ts`'s
  /// own filter for why one template covers both outcomes.
  "billing.trial.ended": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "INFO",
    render: (data: { organizationName: string }) => ({
      title: "Trial ended",
      body: `${data.organizationName}'s trial has ended.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Reacts to `billing.credit.issued` (`credit-service.ts`).
  "billing.credit.issued": template({
    version: 1,
    active: true,
    category: "BILLING",
    severity: "INFO",
    render: (data: { organizationName: string; amountFormatted: string }) => ({
      title: "Credit issued",
      body: `A credit of ${data.amountFormatted} was added to ${data.organizationName}'s account.`,
      actionUrl: "/organizations",
    }),
  }),

  /// Module 12 — reacts to `organization.invitation_policy.updated`
  /// (`organization-security-service.ts`). Unlike the three lifecycle
  /// templates above (fan-out to every ACTIVE member), this one's
  /// recipient set is deliberately narrower — owner + admin only (see
  /// `subscribers.ts`'s own handler) — a `member`/`viewer` cannot invite
  /// anyone regardless of this policy, so a change to it is not
  /// meaningful information for them.
  "organization.invitation_policy.updated": template({
    version: 1,
    active: true,
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    render: (data: { organizationName: string; changedByName: string }) => ({
      title: "Invitation policy changed",
      body: `${data.changedByName} updated ${data.organizationName}'s invitation policy. Review the new rules before inviting anyone.`,
      actionUrl: "/organizations",
    }),
  }),
  /// Module 19 — reacts to `crm.task.assigned` (`crm-task-service.ts`).
  /// The one justified CRM notification (see crm-architecture.md
  /// "Notification strategy") — every other CRM event is either
  /// immutable-activity-as-its-own-record or routine settings CRUD, not
  /// a "something now needs YOUR attention" event the way a task
  /// assignment is.
  "crm.task.assigned": template({
    version: 1,
    active: true,
    category: "CRM_ACTIVITY",
    severity: "INFO",
    render: (data: { taskTitle: string }) => ({
      title: "CRM task assigned to you",
      body: `You were assigned a CRM follow-up task: "${data.taskTitle}".`,
      actionUrl: "/admin/crm/tasks",
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
