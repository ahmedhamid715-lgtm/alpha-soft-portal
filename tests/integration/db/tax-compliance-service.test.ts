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

// Same reserved-currency cross-file-isolation trick every other Module
// 15/16 platform-aggregate test file already uses.
const PLATFORM_TEST_CURRENCY = "NZD";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("tax-compliance-service (database integration)", () => {
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
    await organizationRepository.create({ id: orgAId, name: "Tax Test Org A", displayName: "Tax Test Org A", slug: `tax-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: PLATFORM_TEST_CURRENCY, provider: "STRIPE", providerCustomerId: `cus_tax_test_${generateId()}` }, tx),
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

  async function seedInvoiceWithTaxes(status: "OPEN" | "PAID" | "DRAFT", total: number, taxes: { providerTaxRateId: string | null; taxabilityReason: string | null; taxBehavior?: string | null; amount: number }[]) {
    const invoiceNumber = await nextInvoiceNumber();
    const taxTotal = taxes.reduce((sum, t) => sum + t.amount, 0);
    const invoice = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, invoiceNumber, status, currency: PLATFORM_TEST_CURRENCY, subtotal: total - taxTotal, discountTotal: 0, taxTotal, total, amountPaid: status === "PAID" ? total : 0, amountDue: status === "PAID" ? 0 : total, issueDate: new Date(), provider: "STRIPE" },
        tx,
      ),
    );
    return withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.addLineItem(
        { id: generateId(), invoiceId: invoice.id, description: "Tax test line", quantity: 1, unitAmount: total - taxTotal, subtotal: total - taxTotal, discountAmount: 0, taxAmount: taxTotal, total: total - taxTotal, taxes: taxes.map((t) => ({ id: generateId(), taxBehavior: null, ...t })) },
        tx,
      ),
    );
  }

  it("requires billing.compliance.read — an organization owner is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "tax-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformTaxComplianceReport } = await import("@/server/services/tax-compliance-service");
    await expect(getPlatformTaxComplianceReport({ period: "today" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getPlatformTaxComplianceReport: sums tax collected today, broken down by taxability reason and provider tax rate id", async () => {
    await seedInvoiceWithTaxes("PAID", 10850, [
      { providerTaxRateId: "txr_state_ca", taxabilityReason: "standard_rated", amount: 700 },
      { providerTaxRateId: "txr_county_alameda", taxabilityReason: "standard_rated", amount: 150 },
    ]);

    const owner = await makeMember(platformOrgId, "platform_owner", "tax-report-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformTaxComplianceReport } = await import("@/server/services/tax-compliance-service");
    const result = await getPlatformTaxComplianceReport({ period: "today" });

    expect(result.totalsByCurrency.find((r) => r.currency === PLATFORM_TEST_CURRENCY)).toEqual({ currency: PLATFORM_TEST_CURRENCY, amount: 850 });
    const stateRow = result.breakdown.find((r) => r.currency === PLATFORM_TEST_CURRENCY && r.providerTaxRateId === "txr_state_ca");
    expect(stateRow).toMatchObject({ taxabilityReason: "standard_rated", amount: 700, componentCount: 1 });
    const countyRow = result.breakdown.find((r) => r.currency === PLATFORM_TEST_CURRENCY && r.providerTaxRateId === "txr_county_alameda");
    expect(countyRow).toMatchObject({ taxabilityReason: "standard_rated", amount: 150, componentCount: 1 });
  });

  it("a null providerTaxRateId/taxabilityReason from the provider is grouped under 'unknown', never silently dropped from the report", async () => {
    await seedInvoiceWithTaxes("PAID", 5300, [{ providerTaxRateId: null, taxabilityReason: null, amount: 300 }]);

    const owner = await makeMember(platformOrgId, "platform_owner", "tax-unknown-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformTaxComplianceReport } = await import("@/server/services/tax-compliance-service");
    const result = await getPlatformTaxComplianceReport({ period: "today" });

    const row = result.breakdown.find((r) => r.currency === PLATFORM_TEST_CURRENCY && r.amount === 300);
    expect(row).toMatchObject({ providerTaxRateId: "unknown", taxabilityReason: "unknown" });
  });

  it("a DRAFT invoice's tax is excluded — never actually issued", async () => {
    await seedInvoiceWithTaxes("DRAFT", 10850, [{ providerTaxRateId: "txr_should_not_appear", taxabilityReason: "standard_rated", amount: 850 }]);

    const owner = await makeMember(platformOrgId, "platform_owner", "tax-draft-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformTaxComplianceReport } = await import("@/server/services/tax-compliance-service");
    const result = await getPlatformTaxComplianceReport({ period: "today" });

    expect(result.breakdown.some((r) => r.providerTaxRateId === "txr_should_not_appear")).toBe(false);
  });

  it("a custom period entirely before the invoice's issueDate excludes it", async () => {
    await seedInvoiceWithTaxes("PAID", 10850, [{ providerTaxRateId: "txr_out_of_range", taxabilityReason: "standard_rated", amount: 850 }]);

    const owner = await makeMember(platformOrgId, "platform_owner", "tax-out-of-range-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformTaxComplianceReport } = await import("@/server/services/tax-compliance-service");
    const result = await getPlatformTaxComplianceReport({ periodStart: "2020-01-01T00:00:00.000Z", periodEnd: "2020-02-01T00:00:00.000Z" });

    expect(result.breakdown.some((r) => r.providerTaxRateId === "txr_out_of_range")).toBe(false);
  });
});
