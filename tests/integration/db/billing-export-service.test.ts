import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";
import { invoiceRepository } from "@/server/repositories/invoice-repository";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

describe.skipIf(!isDatabaseConfigured)("billing-export-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let platformOrgId: string;
  let accountA: Awaited<ReturnType<typeof billingAccountRepository.create>>;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Export Test Org A", displayName: "Export Test, Org \"A\"", slug: `export-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Export Test Org B", displayName: "Export Test Org B", slug: `export-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_export_test_${generateId()}` }, tx),
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

  it("exportOrganizationInvoices: streams a CSV with the correct header, one row per invoice, exact decimal money (never a float artifact)", async () => {
    const invoiceNumber = await nextInvoiceNumber();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, invoiceNumber, status: "PAID", currency: "USD", subtotal: 19999, discountTotal: 0, taxTotal: 0, total: 19999, amountPaid: 19999, amountDue: 0, issueDate: new Date("2026-08-01"), provider: "STRIPE" },
        tx,
      ),
    );

    const owner = await makeMember(orgAId, "owner", "export-invoice-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { exportOrganizationInvoices } = await import("@/server/services/billing-export-service");
    const stream = await exportOrganizationInvoices({ organizationId: orgAId });
    const csv = await readStream(stream);

    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("invoice_number,organization_id,status,currency,subtotal,total,amount_paid,amount_due,issue_date,due_date,paid_at");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(invoiceNumber);
    expect(lines[1]).toContain("199.99"); // exact decimal, never "199.98999999999998" or similar float artifact
  });

  it("exportOrganizationInvoices: a member without billing.read is denied", async () => {
    const member = await makeMember(orgAId, "member", "export-denied-member@example.com");
    actAs(member.userId, member.membership);
    const { exportOrganizationInvoices } = await import("@/server/services/billing-export-service");
    await expect(exportOrganizationInvoices({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("exportOrganizationInvoices: Org B's owner cannot export Org A's invoices via a forged organizationId (cross-tenant IDOR)", async () => {
    const invoiceNumber = await nextInvoiceNumber();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, invoiceNumber, status: "PAID", currency: "USD", subtotal: 1000, discountTotal: 0, taxTotal: 0, total: 1000, amountPaid: 1000, amountDue: 0, issueDate: new Date(), provider: "STRIPE" },
        tx,
      ),
    );
    const ownerB = await makeMember(orgBId, "owner", "export-cross-tenant-owner@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { exportOrganizationInvoices } = await import("@/server/services/billing-export-service");
    await expect(exportOrganizationInvoices({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("exportPlatformInvoices: requires billing.reports.export — platform_admin (analytics.read only, no reports.export) is denied", async () => {
    const admin = await makeMember(platformOrgId, "platform_admin", "export-platform-admin-denied@example.com");
    actAs(admin.userId, admin.membership);
    const { exportPlatformInvoices } = await import("@/server/services/billing-export-service");
    await expect(exportPlatformInvoices({})).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("exportPlatformInvoices: platform_owner (billing.reports.export) can export; the export itself is audited", async () => {
    const owner = await makeMember(platformOrgId, "platform_owner", "export-platform-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { exportPlatformInvoices } = await import("@/server/services/billing-export-service");
    const stream = await exportPlatformInvoices({});
    const csv = await readStream(stream);
    expect(csv.split("\n")[0]).toBe("invoice_number,organization_id,status,currency,subtotal,total,amount_paid,amount_due,issue_date,due_date,paid_at");

    const auditEvent = await db.auditEvent.findFirst({ where: { action: "billing.report.exported", resourceName: "invoices" }, orderBy: { createdAt: "desc" } });
    expect(auditEvent).not.toBeNull();
  });

  it("CSV injection: an organization display name starting with '=' is neutralized with a leading apostrophe in the export", async () => {
    const injectionOrgId = generateId();
    await organizationRepository.create({ id: injectionOrgId, name: "Injection Org", displayName: "=cmd|' /C calc'!A1", slug: `export-injection-org-${injectionOrgId}` });
    orgIds.push(injectionOrgId);
    const accountInj = await withTenantContext({ userId: null, organizationId: injectionOrgId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: injectionOrgId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_injection_test_${generateId()}` }, tx),
    );
    const owner = await makeMember(injectionOrgId, "owner", "export-injection-owner@example.com");
    actAs(owner.userId, owner.membership);

    // The invoice CSV doesn't include the org's own display name as a
    // column (only its id) — credits DO carry a free-text `reason`
    // field, a realistic injection vector an organization-adjacent
    // actor could actually influence.
    const { creditLedgerRepository } = await import("@/server/repositories/credit-ledger-repository");
    await withTenantContext({ userId: null, organizationId: injectionOrgId, isPlatformStaff: true }, (tx) =>
      creditLedgerRepository.create({ id: generateId(), organizationId: injectionOrgId, billingAccountId: accountInj.id, type: "CREDIT", amount: 100, currency: "USD", reason: "=cmd|' /C calc'!A1" }, tx),
    );

    const { exportOrganizationCredits } = await import("@/server/services/billing-export-service");
    const stream = await exportOrganizationCredits({ organizationId: injectionOrgId });
    const csv = await readStream(stream);
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/[^']=cmd/); // never an UN-neutralized leading '='
  });
});
