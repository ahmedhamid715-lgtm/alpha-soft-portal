import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 09 — direct database-level RLS tests for `Notification`/
 * `NotificationDelivery`, same methodology `audit-rls.test.ts` already
 * established (real Postgres, the genuinely restricted `alpha_os_app`
 * role via `withTenantContext()`, never a superuser, never mocked).
 *
 * `Notification`'s own SELECT/UPDATE policies are keyed on
 * `recipient_user_id`, not organization membership — see
 * `docs/architecture/notifications.md` "Notification — recipient-owned,
 * organization-*associated*" — so these tests prove RECIPIENT isolation,
 * not (only) organization isolation: two users in the SAME organization
 * must not see each other's notifications.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Notification/NotificationDelivery Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const notificationIds: string[] = [];

  let orgId: string;
  let userAId: string;
  let userBId: string;

  async function seed() {
    orgId = generateId();
    await organizationRepository.create({ id: orgId, name: "Notification RLS Org", displayName: "Notification RLS Org", slug: `notification-rls-org-${orgId}` });
    orgIds.push(orgId);

    const userA = await userRepository.create({ id: generateId(), email: `notif-rls-a-${generateId()}@example.com`, name: "User A" });
    const userB = await userRepository.create({ id: generateId(), email: `notif-rls-b-${generateId()}@example.com`, name: "User B" });
    userAId = userA.id;
    userBId = userB.id;
    userIds.push(userAId, userBId);
  }
  const seeded = seed();

  afterAll(async () => {
    await seeded;
    if (notificationIds.length) await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  function notificationRow(recipientUserId: string, overrides: Partial<Prisma.NotificationUncheckedCreateInput> = {}): Prisma.NotificationUncheckedCreateInput {
    const id = generateId();
    return {
      id,
      organizationId: orgId,
      recipientUserId,
      category: "ACCOUNT_SECURITY",
      severity: "INFO" as const,
      title: "Test notification",
      body: "Test body",
      sourceEventType: "test.event",
      idempotencyKey: `test.event:none:${id}`,
      ...overrides,
    };
  }

  it("recipient A can insert their own notification; SELECT under recipient A's own context sees it, recipient B does not — same organization, different recipients", async () => {
    await seeded;
    const data = notificationRow(userAId);
    notificationIds.push(data.id);

    await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.create({ data }));

    const seenByA = await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) =>
      tx.notification.findUnique({ where: { id: data.id } }),
    );
    expect(seenByA?.id).toBe(data.id);

    // The real point of this test: A and B are members of the SAME
    // organization — an org-membership-keyed policy (the shape every
    // OTHER RLS-protected table in this codebase uses) would let B see
    // this row. B must not.
    const seenByB = await withTenantContext({ userId: userBId, organizationId: orgId, isPlatformStaff: false }, (tx) =>
      tx.notification.findUnique({ where: { id: data.id } }),
    );
    expect(seenByB).toBeNull();
  });

  it("recipient B cannot UPDATE recipient A's notification (mark-read forgery)", async () => {
    await seeded;
    const data = notificationRow(userAId);
    notificationIds.push(data.id);
    await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.create({ data }));

    const result = await withTenantContext({ userId: userBId, organizationId: orgId, isPlatformStaff: false }, (tx) =>
      tx.notification.updateMany({ where: { id: data.id }, data: { status: "READ" } }),
    );
    // Filtered to zero rows by the UPDATE policy's `USING` clause — not a
    // thrown error (UPDATE, unlike audit_events, is genuinely granted at
    // the GRANT layer; RLS is what narrows it to nothing here).
    expect(result.count).toBe(0);

    const real = await db.notification.findUnique({ where: { id: data.id } });
    expect(real?.status).toBe("UNREAD");
  });

  it("a client cannot forge a NotificationDelivery for another organization — WITH CHECK rejects an organizationId mismatched with tenant context", async () => {
    await seeded;
    const data = notificationRow(userAId);
    notificationIds.push(data.id);
    await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.create({ data }));

    const otherOrgId = generateId();
    await expect(
      withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) =>
        tx.notificationDelivery.create({
          data: { id: generateId(), notificationId: data.id, organizationId: otherOrgId, channel: "IN_APP", provider: "in-app", status: "PENDING" },
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("no regular-user SELECT path exists on notification_deliveries at all — a non-platform context sees nothing, even for its own organization's deliveries", async () => {
    await seeded;
    const data = notificationRow(userAId);
    notificationIds.push(data.id);
    await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.create({ data }));

    const deliveryId = generateId();
    await withTenantContext({ userId: null, organizationId: orgId, isPlatformStaff: true }, (tx) =>
      tx.notificationDelivery.create({ data: { id: deliveryId, notificationId: data.id, organizationId: orgId, channel: "IN_APP", provider: "in-app", status: "PENDING" } }),
    );

    const seenByRegularUser = await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) =>
      tx.notificationDelivery.findUnique({ where: { id: deliveryId } }),
    );
    expect(seenByRegularUser).toBeNull();

    const seenByPlatform = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
      tx.notificationDelivery.findUnique({ where: { id: deliveryId } }),
    );
    expect(seenByPlatform?.id).toBe(deliveryId);
  });

  it("DELETE on notifications is unconditionally rejected — REVOKEd at the GRANT layer, not merely policy-filtered to zero rows", async () => {
    await seeded;
    const data = notificationRow(userAId);
    notificationIds.push(data.id);
    await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.create({ data }));

    await expect(
      withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.deleteMany({ where: { id: data.id } })),
    ).rejects.toBeDefined();

    const real = await db.notification.findUnique({ where: { id: data.id } });
    expect(real).not.toBeNull();
  });

  it("NO tenant context at all fails closed — recipient_user_id = NULL matches nothing, never everything", async () => {
    await seeded;
    const data = notificationRow(userAId);
    notificationIds.push(data.id);
    await withTenantContext({ userId: userAId, organizationId: orgId, isPlatformStaff: false }, (tx) => tx.notification.create({ data }));

    // Same "no context → zero rows, not a bypass" methodology
    // `rls.test.ts`'s own "NO tenant context" test uses — still the
    // restricted `alpha_os_app` role (via `withTenantContext()`), just
    // with every context value unset, so `tenant_current_user_id()`
    // evaluates to NULL inside Postgres and `recipient_user_id = NULL`
    // is never TRUE.
    const row = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
      tx.notification.findUnique({ where: { id: data.id } }),
    );
    expect(row).toBeNull();

    const count = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.notification.count());
    expect(count).toBe(0);
  });
});
