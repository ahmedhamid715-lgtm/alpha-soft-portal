import "server-only";
import { events } from "@/lib/platform/events";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { notificationService } from "./service";

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
