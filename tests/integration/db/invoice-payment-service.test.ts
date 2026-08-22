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
import { paymentRepository } from "@/server/repositories/payment-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";

/**
 * `invoice-service.ts`/`payment-service.ts` (Module 13) — `billing.read`
 * gating, cursor pagination (spec §41 — never offset), and the IDOR
 * boundary (spec §55 Q1/Q2): a forged `invoiceId`/`paymentId` belonging
 * to another organization must be indistinguishable from "doesn't
 * exist."
 */

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("invoice-service / payment-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};
  let accountA: Awaited<ReturnType<typeof billingAccountRepository.create>>;

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Invoice Test Org A", displayName: "Invoice Test Org A", slug: `invoice-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Invoice Test Org B", displayName: "Invoice Test Org B", slug: `invoice-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_invoice_test_${generateId()}` }, tx),
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

  async function seedInvoice(organizationId: string, billingAccountId: string) {
    const invoiceNumber = await nextInvoiceNumber();
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        {
          id: generateId(),
          organizationId,
          billingAccountId,
          invoiceNumber,
          status: "PAID",
          currency: "USD",
          subtotal: 5000,
          discountTotal: 0,
          taxTotal: 0,
          total: 5000,
          amountPaid: 5000,
          amountDue: 0,
          issueDate: new Date(),
          provider: "STRIPE",
        },
        tx,
      ),
    );
  }

  it("owner can list their organization's invoices (billing.read), cursor-paginated", async () => {
    const owner = await makeMember(orgAId, "owner", "invoice-list-owner@example.com");
    await seedInvoice(orgAId, accountA.id);
    await seedInvoice(orgAId, accountA.id);
    actAs(owner.userId, owner.membership);

    const { listInvoicesForOrganization } = await import("@/server/services/invoice-service");
    const page = await listInvoicesForOrganization({ organizationId: orgAId, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.pageInfo.hasNextPage).toBe(true);
    expect(page.pageInfo).not.toHaveProperty("page"); // cursor shape, never offset (spec §41)
  });

  it("a member without billing.read cannot list invoices", async () => {
    const member = await makeMember(orgAId, "member", "invoice-list-member@example.com");
    actAs(member.userId, member.membership);
    const { listInvoicesForOrganization } = await import("@/server/services/invoice-service");
    await expect(listInvoicesForOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's owner cannot read Org A's specific invoice by forged invoiceId (spec §55 Q1)", async () => {
    const invoice = await seedInvoice(orgAId, accountA.id);
    const ownerB = await makeMember(orgBId, "owner", "invoice-cross-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);

    const { getInvoiceForOrganization } = await import("@/server/services/invoice-service");
    // Forged to Org B's own id with Org A's real invoiceId — must fail
    // as NOT_FOUND (never leak that the invoice exists under someone
    // else's organization).
    await expect(getInvoiceForOrganization({ organizationId: orgBId, invoiceId: invoice.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getInvoiceForOrganization returns the invoice with its line items for the real owner", async () => {
    const owner = await makeMember(orgAId, "owner", "invoice-get-owner@example.com");
    const invoice = await seedInvoice(orgAId, accountA.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.addLineItem({ id: generateId(), invoiceId: invoice.id, description: "Test line", quantity: 1, unitAmount: 5000, subtotal: 5000, discountAmount: 0, taxAmount: 0, total: 5000 }, tx),
    );
    actAs(owner.userId, owner.membership);

    const { getInvoiceForOrganization } = await import("@/server/services/invoice-service");
    const result = await getInvoiceForOrganization({ organizationId: orgAId, invoiceId: invoice.id });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]?.description).toBe("Test line");
  });

  it("listPaymentsForOrganization: cross-tenant IDOR via forged organizationId is denied", async () => {
    const ownerB = await makeMember(orgBId, "owner", "payment-cross-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { listPaymentsForOrganization } = await import("@/server/services/payment-service");
    await expect(listPaymentsForOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("listRefundsForPayment: a forged paymentId belonging to another organization is rejected", async () => {
    const payment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      paymentRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, amount: 5000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_test_${generateId()}` },
        tx,
      ),
    );
    const ownerB = await makeMember(orgBId, "owner", "refund-list-cross-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { listRefundsForPayment } = await import("@/server/services/payment-service");
    await expect(listRefundsForPayment({ organizationId: orgBId, paymentId: payment.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
