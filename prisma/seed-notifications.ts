/**
 * Module 09 (Notification & Communication Infrastructure) dev fixtures
 * (spec section 29) — unread/read/archived notifications, a mandatory
 * (both-channel) security notification, a successful delivery, a
 * terminal failed delivery, and a retryable pending delivery, on top of
 * the existing Org A/Org B roster `seed-rbac.ts` already seeded.
 *
 * Deliberately uses the REPOSITORY layer directly
 * (`notificationRepository`/`notificationDeliveryRepository`/
 * `notificationPreferenceRepository`), never `notificationService` —
 * same reasoning `seed-user-org-management.ts`'s own top comment
 * documents for itself: `notificationService` transitively imports
 * `@/lib/auth/session-guard` (identity resolution for the current
 * caller), which pulls in `@/auth` (next-auth)'s own module graph —
 * fine inside a real Next.js server, but this seed script runs as a
 * bare `tsx` process with no Next.js runtime in the loop.
 *
 * Idempotent: every notification is found-or-created by its own
 * `idempotencyKey` — the exact structural guarantee
 * `Notification.idempotencyKey`'s unique constraint provides in
 * production, reused here so a repeat `npm run db:seed` is a no-op.
 */
import { generateId } from "../src/lib/utils/id";
import { db } from "../src/lib/db/client";
import { notificationRepository } from "../src/server/repositories/notification-repository";
import { notificationDeliveryRepository } from "../src/server/repositories/notification-delivery-repository";
import { notificationPreferenceRepository } from "../src/server/repositories/notification-preference-repository";
import { userRepository } from "../src/server/repositories/user-repository";

async function ensureNotification(input: {
  organizationId: string | null;
  recipientEmail: string;
  category: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  actionUrl?: string;
  status?: "UNREAD" | "READ" | "ARCHIVED";
  sourceEventType: string;
  sourceEntityId?: string;
}): Promise<{ id: string; recipientUserId: string }> {
  const recipient = await userRepository.findByEmail(input.recipientEmail);
  if (!recipient) throw new Error(`[seed-notifications] User "${input.recipientEmail}" not seeded yet — run seedRbac()/seedAuthorizationFixtures() first.`);

  const idempotencyKey = `${input.sourceEventType}:${input.sourceEntityId ?? "none"}:${recipient.id}`;
  const existing = await notificationRepository.findByIdempotencyKey(idempotencyKey);
  if (existing) return { id: existing.id, recipientUserId: recipient.id };

  const id = generateId();
  const created = await notificationRepository.create({
    id,
    organizationId: input.organizationId,
    recipientUserId: recipient.id,
    category: input.category,
    severity: input.severity,
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl ?? null,
    metadata: null,
    sourceEventType: input.sourceEventType,
    sourceEntityType: null,
    sourceEntityId: input.sourceEntityId ?? null,
    idempotencyKey,
    expiresAt: null,
  });

  if (input.status && input.status !== "UNREAD") {
    await db.notification.update({
      where: { id: created.id },
      data:
        input.status === "READ"
          ? { status: "READ", readAt: new Date() }
          : { status: "ARCHIVED", archivedAt: new Date() },
    });
  }

  return { id: created.id, recipientUserId: recipient.id };
}

async function ensureDelivery(
  notificationId: string,
  organizationId: string | null,
  channel: "IN_APP" | "EMAIL",
  outcome: "SENT" | "FAILED" | "PENDING_RETRY",
): Promise<void> {
  const existing = await db.notificationDelivery.findFirst({ where: { notificationId, channel } });
  if (existing) return;

  const id = generateId();
  const created = await notificationDeliveryRepository.create({
    id,
    notificationId,
    organizationId,
    channel,
    provider: channel === "EMAIL" ? "console" : "in-app",
    status: "PENDING",
  });

  if (outcome === "SENT") {
    await notificationDeliveryRepository.update(created.id, { status: "SENT", sentAt: new Date(), attemptCount: 1 });
  } else if (outcome === "FAILED") {
    await notificationDeliveryRepository.update(created.id, {
      status: "FAILED",
      failedAt: new Date(),
      attemptCount: 5,
      failureCode: "invalid_recipient",
      failureReason: "The provider rejected this address as undeliverable.",
    });
  } else {
    await notificationDeliveryRepository.update(created.id, {
      status: "PENDING",
      attemptCount: 1,
      failureCode: "provider_timeout",
      failureReason: "The provider did not respond in time — will retry.",
      nextAttemptAt: new Date(Date.now() + 5 * 60_000),
    });
  }
}

// `sourceEntityId` is `@db.Uuid` — fixed, stable UUID literals (not
// `generateId()`, which mints a fresh UUIDv7 every call) so each
// fixture's own `idempotencyKey` is identical across repeat
// `npm run db:seed` runs — the entire point of `ensureNotification()`'s
// find-or-create-by-idempotencyKey shape below.
const SEED_ENTITY = {
  membershipReactivated: "00000000-0000-7000-9000-000000000001",
  membershipSuspended: "00000000-0000-7000-9000-000000000002",
  marketingAnnouncement: "00000000-0000-7000-9000-000000000003",
  passwordChangedOwnerA: "00000000-0000-7000-9000-000000000004",
  membershipRemovedFailed: "00000000-0000-7000-9000-000000000005",
  ownershipTransferredRetry: "00000000-0000-7000-9000-000000000006",
} as const;

export async function seedNotificationFixtures(): Promise<void> {
  const orgA = await db.organization.findUnique({ where: { slug: "acme-corp-dev" } });
  const orgB = await db.organization.findUnique({ where: { slug: "beta-industries-dev" } });
  if (!orgA || !orgB) throw new Error("[seed-notifications] Org A/Org B not seeded yet — run seedAuthorizationFixtures() first.");

  // --- member-a: an unread + a read + an archived notification, so the
  // notification center's three status tabs each have something real to
  // show without needing to click through the UI to produce them.
  const unread = await ensureNotification({
    organizationId: orgA.id,
    recipientEmail: "member-a@alpha-os.test",
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    title: "Access restored",
    body: "Your access to Acme Corp was restored.",
    actionUrl: "/organizations",
    sourceEventType: "MembershipStatusChanged",
    sourceEntityId: SEED_ENTITY.membershipReactivated,
  });
  await ensureDelivery(unread.id, orgA.id, "IN_APP", "SENT");

  const read = await ensureNotification({
    organizationId: orgA.id,
    recipientEmail: "member-a@alpha-os.test",
    category: "ORGANIZATION_ACTIVITY",
    severity: "WARNING",
    title: "Access suspended",
    body: "Your access to Acme Corp was suspended by an administrator.",
    actionUrl: "/organizations",
    status: "READ",
    sourceEventType: "MembershipStatusChanged",
    sourceEntityId: SEED_ENTITY.membershipSuspended,
  });
  await ensureDelivery(read.id, orgA.id, "IN_APP", "SENT");

  const archived = await ensureNotification({
    organizationId: orgA.id,
    recipientEmail: "member-a@alpha-os.test",
    category: "MARKETING",
    severity: "INFO",
    title: "New: notification preferences",
    body: "You can now control how Alpha OS reaches you from Settings → Notifications.",
    status: "ARCHIVED",
    sourceEventType: "seed.marketing.announcement",
    sourceEntityId: SEED_ENTITY.marketingAnnouncement,
  });
  await ensureDelivery(archived.id, orgA.id, "IN_APP", "SENT");

  // --- owner-a: a mandatory, both-channel security notification —
  // demonstrates ACCOUNT_SECURITY's own "cannot be disabled" policy with
  // a real row, both deliveries SENT.
  const security = await ensureNotification({
    organizationId: null, // pre-tenant — same as the real password-reset flow
    recipientEmail: "owner-a@alpha-os.test",
    category: "ACCOUNT_SECURITY",
    severity: "CRITICAL",
    title: "Your password was changed",
    body: "Your Alpha OS password was just changed and every other active session was signed out. If this wasn't you, reset your password immediately.",
    actionUrl: "/settings/account",
    sourceEventType: "PasswordResetCompleted",
    sourceEntityId: SEED_ENTITY.passwordChangedOwnerA,
  });
  await ensureDelivery(security.id, null, "IN_APP", "SENT");
  await ensureDelivery(security.id, null, "EMAIL", "SENT");

  // --- admin-a: a terminal FAILED email delivery — gives
  // `/admin/notifications` (platform observability) a real failure row
  // to display and filter on, without needing a real provider outage.
  const failedDeliveryNotification = await ensureNotification({
    organizationId: orgA.id,
    recipientEmail: "admin-a@alpha-os.test",
    category: "ORGANIZATION_ACTIVITY",
    severity: "WARNING",
    title: "Removed from organization",
    body: "You were removed from Acme Corp. You no longer have access to its data.",
    sourceEventType: "MembershipRemoved",
    sourceEntityId: SEED_ENTITY.membershipRemovedFailed,
  });
  await ensureDelivery(failedDeliveryNotification.id, orgA.id, "IN_APP", "SENT");
  await ensureDelivery(failedDeliveryNotification.id, orgA.id, "EMAIL", "FAILED");

  // --- customer-b: a PENDING/retryable delivery — gives the
  // observability view a real "will retry" row (`nextAttemptAt` in the
  // future) distinct from a terminal failure.
  const retryNotification = await ensureNotification({
    organizationId: orgB.id,
    recipientEmail: "customer-b@alpha-os.test",
    category: "ORGANIZATION_ACTIVITY",
    severity: "INFO",
    title: "You are now the owner",
    body: "You are now the owner of Beta Industries.",
    sourceEventType: "ownership.transferred",
    sourceEntityId: SEED_ENTITY.ownershipTransferredRetry,
  });
  await ensureDelivery(retryNotification.id, orgB.id, "IN_APP", "SENT");
  await ensureDelivery(retryNotification.id, orgB.id, "EMAIL", "PENDING_RETRY");

  // --- member-a: an explicit preference override — EMAIL off for
  // ORGANIZATION_ACTIVITY (optional, default-on) — so
  // `/settings/notifications` has a real non-default toggle state to
  // show, not just every category at its default.
  const memberA = await userRepository.findByEmail("member-a@alpha-os.test");
  if (memberA) {
    const existingPref = await notificationPreferenceRepository.find(memberA.id, "ORGANIZATION_ACTIVITY", "EMAIL");
    if (!existingPref) {
      await notificationPreferenceRepository.upsert({ id: generateId(), userId: memberA.id, category: "ORGANIZATION_ACTIVITY", channel: "EMAIL", enabled: false });
    }
  }

  console.log("[seed-notifications] Notification fixtures seeded/verified: 6 notifications (unread/read/archived/security/failed-delivery/pending-retry), 1 preference override.");
}
