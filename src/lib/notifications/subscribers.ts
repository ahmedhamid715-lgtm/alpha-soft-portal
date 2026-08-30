import "server-only";
import { events } from "@/lib/platform/events";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { subscriptionItemRepository } from "@/server/repositories/subscription-repository";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { formatMoney } from "@/lib/utils/money";
import type { NotifyInput } from "./service";
import { notificationService } from "./service";
import type { NotificationTemplateKey } from "./templates";

/**
 * Module 09's own event subscribers — the proof that
 * `DOMAIN EVENT → NOTIFICATION HANDLER → PREFERENCE EVALUATION →
 * NOTIFICATION → DELIVERY RECORD` works end to end (spec section 9),
 * registered on Module 01's existing `events` bus, not a second one.
 * Every handler here reacts to a REAL, already-shipped event from
 * Module 04/07 — `ticket.assigned`, `invoice.paid`, and similar remain
 * documented EXAMPLES for a future module to follow (see
 * `docs/architecture/notifications.md` "Event integration"), not
 * implemented here.
 *
 * Registered once, at server startup, by `src/instrumentation.ts` —
 * importing this module for its side effects (the `events.on()` calls
 * below) is the entire point of importing it at all.
 */

interface MembershipRemovedPayload {
  membershipId: string;
  organizationId: string;
  userId: string;
}

interface MembershipStatusChangedPayload {
  membershipId: string;
  organizationId: string;
  status: "ACTIVE" | "SUSPENDED";
  userId: string;
}

interface OwnershipTransferredPayload {
  organizationId: string;
  fromMembershipId: string;
  toMembershipId: string;
  fromUserId: string;
  toUserId: string;
}

interface PasswordResetCompletedPayload {
  userId: string;
}

async function organizationDisplayName(organizationId: string): Promise<string> {
  const organization = await organizationRepository.findById(organizationId);
  return organization?.displayName ?? "your organization";
}

events.on<MembershipRemovedPayload>("MembershipRemoved", async (event) => {
  const { membershipId, organizationId, userId } = event.payload;
  await notificationService.notify({
    templateKey: "membership.removed",
    recipientUserId: userId,
    organizationId,
    sourceEventType: "MembershipRemoved",
    sourceEntityType: "membership",
    sourceEntityId: membershipId,
    templateData: { organizationName: await organizationDisplayName(organizationId) },
  });
});

events.on<MembershipStatusChangedPayload>("MembershipStatusChanged", async (event) => {
  const { membershipId, organizationId, status, userId } = event.payload;
  // Only SUSPENDED/ACTIVE are notification-worthy transitions today —
  // both templates exist; nothing else currently calls this event with
  // a different status (see `membership-service.ts`'s own schema, which
  // only accepts these two values).
  const templateKey = status === "SUSPENDED" ? "membership.suspended" : "membership.reactivated";
  await notificationService.notify({
    templateKey,
    recipientUserId: userId,
    organizationId,
    sourceEventType: "MembershipStatusChanged",
    sourceEntityType: "membership",
    sourceEntityId: membershipId,
    templateData: { organizationName: await organizationDisplayName(organizationId) },
  });
});

events.on<OwnershipTransferredPayload>("ownership.transferred", async (event) => {
  const { organizationId, fromMembershipId, toMembershipId, fromUserId, toUserId } = event.payload;
  const [organizationName, newOwner] = await Promise.all([organizationDisplayName(organizationId), userRepository.findById(toUserId)]);

  // Two DISTINCT notifications (spec section 4.1 is per-recipient) — the
  // outgoing owner's own idempotency key is scoped to their own
  // membership id, the incoming owner's to theirs, so this is
  // structurally two independent notifications, not one shared row two
  // people would otherwise race to "own."
  await notificationService.notify({
    templateKey: "ownership.transferred_from",
    recipientUserId: fromUserId,
    organizationId,
    sourceEventType: "ownership.transferred",
    sourceEntityType: "membership",
    sourceEntityId: fromMembershipId,
    templateData: { organizationName, newOwnerName: newOwner?.name ?? newOwner?.email ?? "the new owner" },
  });
  await notificationService.notify({
    templateKey: "ownership.transferred_to",
    recipientUserId: toUserId,
    organizationId,
    sourceEventType: "ownership.transferred",
    sourceEntityType: "membership",
    sourceEntityId: toMembershipId,
    templateData: { organizationName },
  });
});

interface OrganizationLifecyclePayload {
  organizationId: string;
}

/**
 * Module 11 — `organization.suspended`/`reactivated`/`archived`
 * (`organization-management-service.ts`) are whole-organization events,
 * unlike every handler above (each of which already has one specific
 * recipient in its own event payload) — every ACTIVE member loses/
 * regains/keeps-but-differently access, so every one of them gets
 * notified, not just the org's owner. `notifyMany()` (not N sequential
 * `notify()` calls) — see `service.ts`'s own reasoning for why that's
 * the right entry point for a real fan-out. `sourceEntityId` is the
 * organization id for all of them; `idempotencyKey`
 * (`{eventType}:{organizationId}:{recipientUserId}`) is still unique
 * per recipient, so this is structurally N independent notifications,
 * never one row N people would race to "own."
 */
async function notifyAllActiveMembers(organizationId: string, templateKey: NotificationTemplateKey, sourceEventType: string): Promise<void> {
  const organization = await organizationRepository.findById(organizationId);
  if (!organization) return; // deleted between the event firing and this handler running — nothing to notify about.

  // Bounded by realistic organization size (spec section 20's own
  // "avoid unbounded queries" applies here too) — 500 is generous for
  // any organization this platform manages today; a future module with
  // genuinely larger organizations should paginate this properly rather
  // than raise the constant.
  const members = await membershipRepository.listForOrganization(organizationId, { page: 1, limit: 500 }, { status: "ACTIVE" });

  const inputs: NotifyInput[] = members.items.map((membership) => ({
    templateKey,
    recipientUserId: membership.userId,
    organizationId,
    sourceEventType,
    sourceEntityType: "organization",
    sourceEntityId: organizationId,
    templateData: { organizationName: organization.displayName },
  }));
  await notificationService.notifyMany(inputs);
}

events.on<OrganizationLifecyclePayload>("organization.suspended", async (event) => {
  await notifyAllActiveMembers(event.payload.organizationId, "organization.suspended", "organization.suspended");
});

events.on<OrganizationLifecyclePayload>("organization.reactivated", async (event) => {
  await notifyAllActiveMembers(event.payload.organizationId, "organization.reactivated", "organization.reactivated");
});

events.on<OrganizationLifecyclePayload>("organization.archived", async (event) => {
  await notifyAllActiveMembers(event.payload.organizationId, "organization.archived", "organization.archived");
});

interface InvitationPolicyUpdatedPayload {
  organizationId: string;
  changedByUserId: string;
}

/**
 * Module 12 — narrower than `notifyAllActiveMembers()` above on purpose:
 * only `owner`/`admin` members can act on an invitation policy at all
 * (`members.invite` is what it gates, and only they hold it — see
 * `roles.ts`), so only they're notified. Bounded to 500 like its sibling
 * above, for the same reason.
 */
events.on<InvitationPolicyUpdatedPayload>("organization.invitation_policy.updated", async (event) => {
  const { organizationId, changedByUserId } = event.payload;
  const organization = await organizationRepository.findById(organizationId);
  if (!organization) return;

  const [members, changedBy] = await Promise.all([
    membershipRepository.listForOrganization(organizationId, { page: 1, limit: 500 }, { status: "ACTIVE" }),
    userRepository.findById(changedByUserId),
  ]);
  const recipients = members.items.filter((m) => (m.role === "owner" || m.role === "admin") && m.userId !== changedByUserId);
  const changedByName = changedBy?.name ?? changedBy?.email ?? "An administrator";

  const inputs: NotifyInput[] = recipients.map((membership) => ({
    templateKey: "organization.invitation_policy.updated",
    recipientUserId: membership.userId,
    organizationId,
    sourceEventType: "organization.invitation_policy.updated",
    sourceEntityType: "organization",
    sourceEntityId: organizationId,
    templateData: { organizationName: organization.displayName, changedByName },
  }));
  await notificationService.notifyMany(inputs);
});

events.on<PasswordResetCompletedPayload>("PasswordResetCompleted", async (event) => {
  await notificationService.notify({
    templateKey: "account.password_reset",
    recipientUserId: event.payload.userId,
    organizationId: null,
    sourceEventType: "PasswordResetCompleted",
    sourceEntityType: "user",
    sourceEntityId: event.payload.userId,
    templateData: {},
  });
});

// --- Module 13 — billing (spec §29: "only implement notifications with
// actual business value. Do not spam users."). Recipients are owner +
// admin only — the same audience `billing.read`/`billing.manage` are
// granted to (`ORGANIZATION_FULL`/`owner` in `roles.ts`); a `member`/
// `viewer` cannot see billing at all, so a billing notification isn't
// meaningful to them.

async function notifyBillingRecipients(
  organizationId: string,
  templateKey: NotificationTemplateKey,
  sourceEventType: string,
  sourceEntityType: string,
  sourceEntityId: string,
  templateData: Record<string, unknown>,
): Promise<void> {
  const [organization, members] = await Promise.all([
    organizationRepository.findById(organizationId),
    membershipRepository.listForOrganization(organizationId, { page: 1, limit: 500 }, { status: "ACTIVE" }),
  ]);
  if (!organization) return;
  const recipients = members.items.filter((m) => m.role === "owner" || m.role === "admin");

  const inputs: NotifyInput[] = recipients.map((membership) => ({
    templateKey,
    recipientUserId: membership.userId,
    organizationId,
    sourceEventType,
    sourceEntityType,
    sourceEntityId,
    templateData: { organizationName: organization.displayName, ...templateData },
  }));
  await notificationService.notifyMany(inputs);
}

interface BillingSubscriptionEventPayload {
  organizationId: string;
  subscriptionId: string;
  status: string;
  previousStatus?: string | null;
}

async function resolveSubscriptionPlanName(subscriptionId: string): Promise<string> {
  const items = await subscriptionItemRepository.listForSubscription(subscriptionId);
  const firstItem = items[0];
  if (!firstItem) return "your plan";
  const price = await planPriceRepository.findById(firstItem.planPriceId);
  if (!price) return "your plan";
  const plan = await planRepository.findById(price.planId);
  return plan?.name ?? "your plan";
}

events.on<BillingSubscriptionEventPayload>("billing.subscription.created", async (event) => {
  const { organizationId, subscriptionId } = event.payload;
  const planName = await resolveSubscriptionPlanName(subscriptionId);
  await notifyBillingRecipients(organizationId, "billing.subscription.created", "billing.subscription.created", "subscription", subscriptionId, { planName });
});

/**
 * `billing.subscription.updated` fires on EVERY reconciled Stripe
 * subscription change — including routine period renewals that keep
 * `status` unchanged. Only two transitions are notification-worthy
 * (spec §29): newly PAST_DUE, and newly CANCELED. Every other update
 * (a renewal, an item reconciliation with no status change) is a
 * silent no-op here, by design.
 */
events.on<BillingSubscriptionEventPayload>("billing.subscription.updated", async (event) => {
  const { organizationId, subscriptionId, status, previousStatus } = event.payload;
  if (status === previousStatus) return;

  if (status === "PAST_DUE") {
    await notifyBillingRecipients(organizationId, "billing.subscription.past_due", "billing.subscription.updated", "subscription", subscriptionId, {});
  } else if (status === "CANCELED") {
    await notifyBillingRecipients(organizationId, "billing.subscription.canceled", "billing.subscription.updated", "subscription", subscriptionId, {});
  } else if (previousStatus === "TRIALING") {
    // Module 14 — leaving TRIALING for any other status is "the trial
    // ended," regardless of whether it converted to a paying
    // subscription (→ ACTIVE) or lapsed (→ anything else) — one
    // template covers both, since the ACTIVE-vs-not distinction is
    // already visible from the billing dashboard itself the moment the
    // customer opens it.
    await notifyBillingRecipients(organizationId, "billing.trial.ended", "billing.subscription.updated", "subscription", subscriptionId, {});
  }
});

interface BillingInvoiceEventPayload {
  organizationId: string;
  invoiceId: string;
}

events.on<BillingInvoiceEventPayload>("billing.invoice.created", async (event) => {
  const { organizationId, invoiceId } = event.payload;
  const invoice = await invoiceRepository.findById(invoiceId);
  if (!invoice) return;
  await notifyBillingRecipients(organizationId, "billing.invoice.created", "billing.invoice.created", "invoice", invoiceId, {
    invoiceNumber: invoice.invoiceNumber,
  });
});

interface BillingPaymentEventPayload {
  organizationId: string;
  invoiceId?: string;
}

events.on<BillingPaymentEventPayload>("billing.payment.succeeded", async (event) => {
  await notifyBillingRecipients(event.payload.organizationId, "billing.payment.succeeded", "billing.payment.succeeded", "payment", event.payload.invoiceId ?? event.payload.organizationId, {});
});

events.on<BillingPaymentEventPayload>("billing.payment.failed", async (event) => {
  await notifyBillingRecipients(event.payload.organizationId, "billing.payment.failed", "billing.payment.failed", "payment", event.payload.invoiceId ?? event.payload.organizationId, {});
});

interface BillingTrialEndingPayload {
  organizationId: string;
  subscriptionId: string;
}

/** Reacts to `customer.subscription.trial_will_end` (`billing-webhook-service.ts`) — Stripe's own 3-day-out signal; Alpha OS runs no scheduling of its own to detect this (see that handler's own comment). */
events.on<BillingTrialEndingPayload>("billing.trial.ending", async (event) => {
  await notifyBillingRecipients(event.payload.organizationId, "billing.trial.ending", "billing.trial.ending", "subscription", event.payload.subscriptionId, {});
});

interface BillingCreditEventPayload {
  organizationId: string;
  entryId: string;
  amount: number;
  currency: string;
}

events.on<BillingCreditEventPayload>("billing.credit.issued", async (event) => {
  const { organizationId, entryId, amount, currency } = event.payload;
  await notifyBillingRecipients(organizationId, "billing.credit.issued", "billing.credit.issued", "credit_ledger_entry", entryId, {
    amountFormatted: formatMoney(amount, currency),
  });
});

// --- Module 19 — CRM (Build 19 / Roadmap 13). The one justified CRM
// notification — see `crm-task-service.ts`'s own comment on why every
// other CRM event doesn't get one.

interface CrmTaskAssignedPayload {
  taskId: string;
  organizationId: string;
  assignedToUserId: string;
  title: string;
}

events.on<CrmTaskAssignedPayload>("crm.task.assigned", async (event) => {
  const { taskId, organizationId, assignedToUserId, title } = event.payload;
  await notificationService.notify({
    templateKey: "crm.task.assigned",
    recipientUserId: assignedToUserId,
    organizationId,
    sourceEventType: "crm.task.assigned",
    sourceEntityType: "crm_task",
    sourceEntityId: taskId,
    templateData: { taskTitle: title },
  });
});

// --- Build 20 — Sales Pipeline (Roadmap Module 14). The one justified
// Sales Pipeline notification — see `crm-deal-service.ts`'s own comment
// on why ordinary stage/value edits don't get one.

interface CrmDealAssignedPayload {
  dealId: string;
  organizationId: string;
  assignedToUserId: string;
  title: string;
}

events.on<CrmDealAssignedPayload>("crm.deal.assigned", async (event) => {
  const { dealId, organizationId, assignedToUserId, title } = event.payload;
  await notificationService.notify({
    templateKey: "crm.deal.assigned",
    recipientUserId: assignedToUserId,
    organizationId,
    sourceEventType: "crm.deal.assigned",
    sourceEntityType: "crm_deal",
    sourceEntityId: dealId,
    templateData: { dealTitle: title },
  });
});
