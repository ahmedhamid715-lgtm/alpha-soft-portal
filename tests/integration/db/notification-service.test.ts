import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";

/**
 * `lib/notifications/service.ts` — real Postgres, mocked identity (same
 * technique `audit-service.test.ts` already established for this
 * codebase's authorization-adjacent integration tests). Covers spec
 * section 16 ("prove idempotency... test concurrent attempts... use
 * real Postgres") and the IDOR-adjacent claims in section 38 that are
 * testable without a running HTTP server (`markRead`/`markUnread`/
 * `archive`/`getUserNotifications` structurally cannot accept another
 * user's id — see `service.ts`'s own top comment).
 */

let mockUser: { id: string; email?: string; name?: string } | null = null;

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    throw new Error("no request scope in tests");
  }),
}));

describe.skipIf(!isDatabaseConfigured)("notification service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let userAId: string;
  let userBId: string;
  let orgId: string;

  beforeEach(async () => {
    mockUser = null;

    orgId = generateId();
    await organizationRepository.create({ id: orgId, name: "Notification Svc Org", displayName: "Notification Svc Org", slug: `notification-svc-${orgId}` });
    orgIds.push(orgId);

    const userA = await userRepository.create({ id: generateId(), email: `notif-svc-a-${generateId()}@example.com`, name: "User A" });
    const userB = await userRepository.create({ id: generateId(), email: `notif-svc-b-${generateId()}@example.com`, name: "User B" });
    userAId = userA.id;
    userBId = userB.id;
    userIds.push(userAId, userBId);
  });

  afterEach(async () => {
    await db.notification.deleteMany({ where: { recipientUserId: { in: userIds } } });
    await db.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function loadService() {
    // Re-imported per test (not top-level) so the module's own
    // `mockUser`-driven `getCurrentUser` mock is fresh — mirrors
    // `audit-service.test.ts`'s own dynamic-import discipline.
    return import("@/lib/notifications/service");
  }

  it("notify() creates one Notification and an IN_APP delivery that reaches SENT synchronously (no external call for that channel)", async () => {
    const { notificationService } = await loadService();

    const notification = await notificationService.notify({
      templateKey: "account.password_reset",
      recipientUserId: userAId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userAId,
      templateData: {},
    });

    expect(notification?.recipientUserId).toBe(userAId);
    expect(notification?.category).toBe("ACCOUNT_SECURITY");

    const deliveries = await db.notificationDelivery.findMany({ where: { notificationId: notification!.id } });
    const inApp = deliveries.find((d) => d.channel === "IN_APP");
    expect(inApp?.status).toBe("SENT");
    // ACCOUNT_SECURITY is mandatory on both channels — EMAIL must have
    // been queued too, regardless of any (nonexistent, for a fresh user)
    // preference row.
    const email = deliveries.find((d) => d.channel === "EMAIL");
    expect(email).toBeDefined();
  });

  it("the same event does not create a duplicate notification — the idempotency key's unique constraint wins the race, never a second row", async () => {
    const { notificationService } = await loadService();

    const input = {
      templateKey: "account.password_reset" as const,
      recipientUserId: userAId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userAId,
      templateData: {},
    };

    // Real concurrency, not a sequential "call twice" — both requests
    // hit the database at effectively the same time; the unique
    // constraint (not an application-level `if exists` check) is what
    // must prevent a second row (spec section 16 / section 38 #11).
    const [a, b] = await Promise.all([notificationService.notify(input), notificationService.notify(input)]);
    expect(a?.id).toBe(b?.id);

    const count = await db.notification.count({ where: { recipientUserId: userAId, sourceEventType: "PasswordResetCompleted" } });
    expect(count).toBe(1);
  });

  it("getUserNotifications() only ever returns the CALLER's own rows — structurally, not by a filter a caller could omit", async () => {
    const { notificationService } = await loadService();

    await notificationService.notify({
      templateKey: "account.password_reset",
      recipientUserId: userAId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userAId,
      templateData: {},
    });
    await notificationService.notify({
      templateKey: "account.password_reset",
      recipientUserId: userBId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userBId,
      templateData: {},
    });

    mockUser = { id: userAId };
    const page = await notificationService.getUserNotifications({});
    expect(page.items.every((n) => n.recipientUserId === userAId)).toBe(true);
    expect(page.items.some((n) => n.recipientUserId === userBId)).toBe(false);
  });

  it("markRead() on another user's notification id is a 404, never a 403 and never a silent success (IDOR)", async () => {
    const { notificationService } = await loadService();

    const notification = await notificationService.notify({
      templateKey: "account.password_reset",
      recipientUserId: userAId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userAId,
      templateData: {},
    });

    mockUser = { id: userBId };
    await expect(notificationService.markRead({ id: notification!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const real = await db.notification.findUnique({ where: { id: notification!.id } });
    expect(real?.status).toBe("UNREAD");
  });

  it("updatePreference() rejects disabling a mandatory category/channel — server-side enforcement, not merely a UI affordance", async () => {
    const { notificationService } = await loadService();
    mockUser = { id: userAId };

    await expect(
      notificationService.updatePreference({ category: "ACCOUNT_SECURITY", channel: "EMAIL", enabled: false }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const rows = await db.notificationPreference.findMany({ where: { userId: userAId } });
    expect(rows).toHaveLength(0);
  });

  it("updatePreference() persists an optional category/channel toggle, then policy.resolveChannels() honors it on the next notify()", async () => {
    const { notificationService } = await loadService();
    mockUser = { id: userAId };

    // ORGANIZATION_ACTIVITY: EMAIL is optional, default-on — turn it off.
    await notificationService.updatePreference({ category: "ORGANIZATION_ACTIVITY", channel: "EMAIL", enabled: false });

    const notification = await notificationService.notify({
      templateKey: "membership.removed",
      recipientUserId: userAId,
      organizationId: orgId,
      sourceEventType: "MembershipRemoved",
      sourceEntityType: "membership",
      sourceEntityId: generateId(),
      templateData: { organizationName: "Test Org" },
    });

    const deliveries = await db.notificationDelivery.findMany({ where: { notificationId: notification!.id } });
    expect(deliveries.some((d) => d.channel === "EMAIL")).toBe(false);
    // IN_APP is mandatory for this category — still queued regardless.
    expect(deliveries.some((d) => d.channel === "IN_APP")).toBe(true);
  });

  it("markAllRead() only affects the caller's own unread notifications", async () => {
    const { notificationService } = await loadService();

    await notificationService.notify({
      templateKey: "account.password_reset",
      recipientUserId: userAId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userAId,
      templateData: {},
    });
    await notificationService.notify({
      templateKey: "account.password_reset",
      recipientUserId: userBId,
      organizationId: null,
      sourceEventType: "PasswordResetCompleted",
      sourceEntityType: "user",
      sourceEntityId: userBId,
      templateData: {},
    });

    mockUser = { id: userAId };
    const updated = await notificationService.markAllRead();
    expect(updated).toBe(1);

    const bRow = await db.notification.findFirst({ where: { recipientUserId: userBId } });
    expect(bRow?.status).toBe("UNREAD");
  });
});
