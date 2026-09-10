import type { NotificationChannel } from "@/generated/prisma/client";

/**
 * The extensible notification-category registry — same
 * `as const satisfies Record<...>` shape `AUDIT_CATALOG` established
 * (Module 08), for the same reason: `Notification.category` is a plain
 * string column (see `schema.prisma`'s own comment), so a future module
 * adds a category here, never a migration.
 *
 * A category answers two questions at once:
 *   1. Which channels does this KIND of notification even support?
 *   2. Which of those channels can the user NOT turn off?
 *
 * See `docs/architecture/notification-preferences.md` for the full
 * mandatory-vs-optional policy this drives.
 */
export interface NotificationCategoryDefinition {
  label: string;
  description: string;
  /** Groups categories in the preferences UI — "Security", "Organization", "System", "Marketing". */
  group: string;
  /** Channels this category is ever attempted on, in preference order. */
  supportedChannels: NotificationChannel[];
  /** Channels the user CANNOT disable for this category, regardless of what `NotificationPreference` says — see `lib/notifications/policy.ts`. */
  mandatoryChannels: NotificationChannel[];
  /** What an unset preference defaults to, per channel. */
  defaultEnabled: Partial<Record<NotificationChannel, boolean>>;
}

function category(def: NotificationCategoryDefinition): NotificationCategoryDefinition {
  return def;
}

export const NOTIFICATION_CATEGORIES = {
  /// Security-critical — spec's own example: "may be non-disableable."
  /// Both channels mandatory: a compromised account is exactly the
  /// scenario where "the user turned off email notifications" must not
  /// mean "the user never found out."
  ACCOUNT_SECURITY: category({
    label: "Account security",
    description: "Password changes, session revocations, and other account-security events.",
    group: "Security",
    supportedChannels: ["IN_APP", "EMAIL"],
    mandatoryChannels: ["IN_APP", "EMAIL"],
    defaultEnabled: { IN_APP: true, EMAIL: true },
  }),

  /// Real, wired category (Module 07 membership/ownership events — see
  /// `lib/notifications/subscribers.ts`). IN_APP mandatory (you should
  /// always be able to see in your own feed that your access changed);
  /// email is the user's choice, default-on since this is meaningfully
  /// actionable, not routine noise.
  ORGANIZATION_ACTIVITY: category({
    label: "Organization activity",
    description: "Membership, role, and ownership changes within your organizations.",
    group: "Organization",
    supportedChannels: ["IN_APP", "EMAIL"],
    mandatoryChannels: ["IN_APP"],
    defaultEnabled: { IN_APP: true, EMAIL: true },
  }),

  /// Module 13 — billing/financial events (payment succeeded/failed,
  /// invoice available, subscription created/changed/canceled). Its own
  /// category, not folded into ORGANIZATION_ACTIVITY — the same
  /// reasoning ACCOUNT_SECURITY already established: a financial event
  /// is a genuinely different kind of "important" than a membership
  /// change, and a user may reasonably want email for one but not the
  /// other. EMAIL default-on (a missed payment-failure email risks
  /// service disruption — this is actionable, not routine), but still
  /// user-optional (unlike ACCOUNT_SECURITY's fully mandatory EMAIL) —
  /// billing notifications don't carry the same "must never be
  /// silenceable" security stakes a compromised-account notice does.
  BILLING: category({
    label: "Billing",
    description: "Payments, invoices, and subscription changes for your organizations.",
    group: "Organization",
    supportedChannels: ["IN_APP", "EMAIL"],
    mandatoryChannels: ["IN_APP"],
    defaultEnabled: { IN_APP: true, EMAIL: true },
  }),

  /// Platform-wide announcements — in-app only (no email channel offered
  /// at all yet; a future module can add EMAIL to `supportedChannels`
  /// without a migration). Mandatory: a maintenance notice must not be
  /// silently suppressible.
  SYSTEM: category({
    label: "System",
    description: "Platform-wide announcements and maintenance notices.",
    group: "System",
    supportedChannels: ["IN_APP"],
    mandatoryChannels: ["IN_APP"],
    defaultEnabled: { IN_APP: true },
  }),

  /// Spec's own explicit "EMAIL = OFF" example — EMAIL fully optional,
  /// default off, no mandatory channel there at all. IN_APP stays
  /// mandatory here too, same as every other category — see this file's
  /// own note on why IN_APP is uniformly mandatory across categories: a
  /// created `Notification` is always visible in the recipient's own
  /// feed; only the EXTRA channels (email, future SMS/push) vary by
  /// category/preference. No real sender exists yet (no marketing
  /// module) — seeded so the preferences UI and policy engine have a
  /// real, working "fully optional extra channel" category to
  /// demonstrate and test, not a placeholder pretending to be wired to
  /// something.
  MARKETING: category({
    label: "Product updates",
    description: "New features and product announcements.",
    group: "Marketing",
    supportedChannels: ["IN_APP", "EMAIL"],
    mandatoryChannels: ["IN_APP"],
    defaultEnabled: { IN_APP: true, EMAIL: false },
  }),
  /// Module 19 — CRM task assignment. This is Alpha Page Rankers' own
  /// internal sales tool (see crm-architecture.md); recipients are
  /// always platform staff, never a customer organization's members —
  /// grouped under "Platform," not "Organization." IN_APP mandatory
  /// (same uniform reasoning as every other category); EMAIL default-on
  /// like BILLING's own reasoning — a missed follow-up assignment is a
  /// real, actionable miss, not routine noise — but still user-optional.
  CRM_ACTIVITY: category({
    label: "CRM task assignments",
    description: "When a CRM follow-up task is assigned to you.",
    group: "Platform",
    supportedChannels: ["IN_APP", "EMAIL"],
    mandatoryChannels: ["IN_APP"],
    defaultEnabled: { IN_APP: true, EMAIL: true },
  }),
  /// Build 27 — Project Management. Its own category, not folded into
  /// `CRM_ACTIVITY`: project assignment/blocked/approval events reach a
  /// genuinely different, larger recipient base than CRM follow-ups
  /// (any internal delivery staff assigned to a project, not just
  /// sales/CRM users) and deserve their own preference control, the
  /// same reasoning `CRM_ACTIVITY` itself was split out from ordinary
  /// `SYSTEM`/`ADMINISTRATION` activity for. EMAIL default-on — a
  /// missed task/approval assignment is a real, actionable miss.
  PROJECT_ACTIVITY: category({
    label: "Project activity",
    description: "When a project or task is assigned to you, a task is blocked, or an approval needs your decision.",
    group: "Platform",
    supportedChannels: ["IN_APP", "EMAIL"],
    mandatoryChannels: ["IN_APP"],
    defaultEnabled: { IN_APP: true, EMAIL: true },
  }),
} as const satisfies Record<string, NotificationCategoryDefinition>;

export type NotificationCategoryKey = keyof typeof NOTIFICATION_CATEGORIES;

export function isNotificationCategoryKey(value: string): value is NotificationCategoryKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_CATEGORIES, value);
}

export function getNotificationCategoryDefinition(key: NotificationCategoryKey): NotificationCategoryDefinition {
  return NOTIFICATION_CATEGORIES[key];
}

export const NOTIFICATION_CATEGORY_KEYS = Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategoryKey[];
