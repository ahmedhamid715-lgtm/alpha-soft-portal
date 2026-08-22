import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";
import { resolvePeriod, splitIntoBuckets } from "@/lib/billing/reporting/period";

// Same cross-file-parallelism-isolation trick `revenue-reporting-service.test.ts`
// already established for platform-wide aggregate assertions — a reserved,
// otherwise-unused currency gives an exact-assertable total immune to
// concurrent test-file pollution.
const PLATFORM_TEST_CURRENCY = "AUD";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("revenue-recognition-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let accountA: Awaited<ReturnType<typeof billingAccountRepository.create>>;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Recognition Test Org A", displayName: "Recognition Test Org A", slug: `recognition-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: PLATFORM_TEST_CURRENCY, provider: "STRIPE", providerCustomerId: `cus_recognition_test_${generateId()}` }, tx),
    );
  });

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeMember(organizationId: string, roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  async function seedInvoiceLine(status: "OPEN" | "PAID" | "DRAFT", total: number, periodStart: Date, periodEnd: Date) {
    const invoiceNumber = await nextInvoiceNumber();
    const invoice = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, invoiceNumber, status, currency: PLATFORM_TEST_CURRENCY, subtotal: total, discountTotal: 0, taxTotal: 0, total, amountPaid: status === "PAID" ? total : 0, amountDue: status === "PAID" ? 0 : total, issueDate: new Date(), provider: "STRIPE" },
        tx,
      ),
    );
    return withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.addLineItem({ id: generateId(), invoiceId: invoice.id, description: "Recognition test line", quantity: 1, unitAmount: total, subtotal: total, discountAmount: 0, taxAmount: 0, total, servicePeriodStart: periodStart, servicePeriodEnd: periodEnd }, tx),
    );
  }

  it("requires billing.compliance.read — an organization owner is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "recognition-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getDeferredRevenueSummary } = await import("@/server/services/revenue-recognition-service");
    await expect(getDeferredRevenueSummary()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("a support_admin (no billing.compliance.read) is denied — this role deliberately does not hold it (see roles.ts)", async () => {
    const support = await makeMember(platformOrgId, "support_admin", "recognition-support-denied@example.com");
    actAs(support.userId, support.membership);
    const { getDeferredRevenueSummary } = await import("@/server/services/revenue-recognition-service");
    await expect(getDeferredRevenueSummary()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getDeferredRevenueSummary: a line item whose period starts in the future is entirely deferred (0 recognized)", async () => {
    const now = new Date();
    const periodStart = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
    const periodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    await seedInvoiceLine("PAID", 3100, periodStart, periodEnd);

    const owner = await makeMember(platformOrgId, "platform_owner", "recognition-deferred-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getDeferredRevenueSummary } = await import("@/server/services/revenue-recognition-service");
    const result = await getDeferredRevenueSummary();

    const row = result.totals.find((r) => r.currency === PLATFORM_TEST_CURRENCY);
    expect(row).toEqual({ currency: PLATFORM_TEST_CURRENCY, totalBilled: 3100, recognized: 0, deferred: 3100 });
  });

  it("getDeferredRevenueSummary: a line item whose period has already fully elapsed is excluded entirely (0 deferred remaining, correctly out of the bounded query)", async () => {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000); // ended yesterday
    await seedInvoiceLine("PAID", 5000, periodStart, periodEnd);

    const owner = await makeMember(platformOrgId, "platform_owner", "recognition-elapsed-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getDeferredRevenueSummary } = await import("@/server/services/revenue-recognition-service");
    const result = await getDeferredRevenueSummary();

    expect(result.totals.find((r) => r.currency === PLATFORM_TEST_CURRENCY)).toBeUndefined();
  });

  it("getDeferredRevenueSummary: a DRAFT invoice's line item is excluded — never issued, not a real billed obligation", async () => {
    const now = new Date();
    await seedInvoiceLine("DRAFT", 7000, new Date(now.getTime() + 60 * 60 * 1000), new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000));

    const owner = await makeMember(platformOrgId, "platform_owner", "recognition-draft-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getDeferredRevenueSummary } = await import("@/server/services/revenue-recognition-service");
    const result = await getDeferredRevenueSummary();

    expect(result.totals.find((r) => r.currency === PLATFORM_TEST_CURRENCY)).toBeUndefined();
  });

  it("getPlatformRecognitionTrend: a line item whose entire period falls within one requested bucket is fully recognized in that bucket, and in no other", async () => {
    // Compute the exact bucket boundaries the service itself will use for
    // "current_year" / 12 buckets, then seed a line whose OWN period is
    // exactly one bucket — robust regardless of what "today" is.
    const currentYear = resolvePeriod("current_year", "UTC", new Date());
    const buckets = splitIntoBuckets(currentYear, 12);
    const targetBucket = buckets[2]!; // the 3rd bucket of the year — arbitrary, just needs to be a real, fully-formed bucket
    await seedInvoiceLine("PAID", 4200, targetBucket.start, targetBucket.end);

    const owner = await makeMember(platformOrgId, "platform_owner", "recognition-trend-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformRecognitionTrend } = await import("@/server/services/revenue-recognition-service");
    const result = await getPlatformRecognitionTrend({ period: "current_year", buckets: 12 });

    const targetPoint = result.points.find((p) => p.bucketStart.getTime() === targetBucket.start.getTime());
    expect(targetPoint?.byCurrency).toEqual([{ currency: PLATFORM_TEST_CURRENCY, amount: 4200 }]);

    const otherPointsWithThisCurrency = result.points.filter((p) => p.bucketStart.getTime() !== targetBucket.start.getTime() && p.byCurrency.some((c) => c.currency === PLATFORM_TEST_CURRENCY));
    expect(otherPointsWithThisCurrency).toEqual([]);
  });
});
