import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { db } from "@/lib/db/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { permissionRepository, rolePermissionRepository } from "@/server/repositories/permission-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { NotFoundError } from "@/lib/errors/app-error";

/**
 * Customer 360 (Build 24 — Roadmap Module 18) composition security.
 * Because Customer 360 introduces NO new persistence — see
 * customer-360.md "Persistence" — there is nothing new to RLS-test at
 * the table level. What genuinely needs proving instead is exactly what
 * the Build 24 authorization calls out: "A cross-domain composition bug
 * is still an IDOR even when each individual table has RLS." This file
 * proves the ONE composition service (`getCustomer360()`) never
 * aggregates a DIFFERENT linked organization's billing data into a
 * company's own view, and that its per-section permission gating is
 * real (a caller who lacks a section's own permission gets that section
 * as `null`, not silently degraded/partial data).
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

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Customer 360 composition security (database integration)", () => {
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  const userIds: string[] = [];
  const orgIds: string[] = [];
  const companyIds: string[] = [];
  const roleIds: string[] = [];
  const billingAccountIds: string[] = [];

  const platformContext = (userId: string): TenantContextInput => ({ userId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (billingAccountIds.length) await db.billingAccount.deleteMany({ where: { id: { in: billingAccountIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    // Users before roles — a membership row FK-references its own
    // roleId, and deleting a User cascades to its memberships (see
    // `User`'s own schema relation), which is what actually clears that
    // reference; deleting the (custom, test-only) role first would hit
    // that still-live FK.
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (roleIds.length) await db.role.deleteMany({ where: { id: { in: roleIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    for (const ids of [billingAccountIds, companyIds, roleIds, userIds, orgIds]) ids.length = 0;
    vi.restoreAllMocks();
  });

  async function makeActor(roleKey: string, roleId: string, email: string) {
    const userId = generateId();
    userIds.push(userId);
    await userRepository.create({ id: userId, email, name: email });
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId });
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[platformOrgId, { organizationId: platformOrgId, userId, roleId, status: "ACTIVE" }]]);
    return userId;
  }

  /** A custom PLATFORM-scope role granting ONLY `crm.read` — no `crm.pipeline.read`/`crm.onboarding.read`/`billing.readPlatform` — to prove per-section gating actually withholds data, not just theoretically checks a permission that every real role happens to also hold. */
  async function makeCrmReadOnlyRole(): Promise<string> {
    const roleId = generateId();
    roleIds.push(roleId);
    await roleRepository.create({ id: roleId, organizationId: null, key: `customer-360-crm-read-only-${roleId}`, name: "Customer 360 test: CRM read only", scope: "PLATFORM", isSystem: false });
    const permissionRows = await permissionRepository.findByKeys(["crm.read"]);
    await rolePermissionRepository.replaceForRole(
      roleId,
      permissionRows.map((p) => ({ id: generateId(), permissionId: p.id })),
      db,
    );
    return roleId;
  }

  async function makeCompanyConvertedTo(name: string): Promise<{ companyId: string; linkedOrgId: string }> {
    const linkedOrgId = generateId();
    orgIds.push(linkedOrgId);
    await organizationRepository.create({ id: linkedOrgId, name: `${name} (linked)`, displayName: `${name} (linked)`, slug: `customer-360-sec-${linkedOrgId}` });

    const companyId = generateId();
    companyIds.push(companyId);
    await withTenantContext(platformContext(mockUser?.id ?? ""), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name, domain: null, industry: null, website: null, phone: null }, tx);
      const linked = await crmCompanyRepository.linkToOrganization(companyId, linkedOrgId, tx);
      expect(linked?.convertedToOrganizationId).toBe(linkedOrgId);
    });
    return { companyId, linkedOrgId };
  }

  it("never aggregates a DIFFERENT linked organization's billing data into this company's own Customer 360 view", async () => {
    const owner = await makeActor("platform_owner", roleByKey.platform_owner!.id, `customer-360-owner-${generateId()}@example.com`);

    const { companyId: companyAId, linkedOrgId: linkedOrgAId } = await makeCompanyConvertedTo(`Customer 360 Sec Co A ${generateId()}`);
    const { linkedOrgId: linkedOrgBId } = await makeCompanyConvertedTo(`Customer 360 Sec Co B ${generateId()}`);

    const billingAccountAId = generateId();
    billingAccountIds.push(billingAccountAId);
    await withTenantContext({ userId: null, organizationId: linkedOrgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: billingAccountAId, organizationId: linkedOrgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_360_sec_a_${generateId()}` }, tx),
    );
    const billingAccountBId = generateId();
    billingAccountIds.push(billingAccountBId);
    await withTenantContext({ userId: null, organizationId: linkedOrgBId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: billingAccountBId, organizationId: linkedOrgBId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_360_sec_b_${generateId()}` }, tx),
    );

    mockUser = { id: owner };
    mockMembershipsByOrg = new Map([[platformOrgId, { organizationId: platformOrgId, userId: owner, roleId: roleByKey.platform_owner!.id, status: "ACTIVE" }]]);
    const { getCustomer360 } = await import("@/server/services/customer-360-service");

    const viewA = await getCustomer360({ companyId: companyAId });
    expect(viewA.linkedOrganization?.id).toBe(linkedOrgAId);
    expect(viewA.billing?.billingAccount.id).toBe(billingAccountAId);
    expect(viewA.billing?.billingAccount.organizationId).toBe(linkedOrgAId);
    // The actual invariant this test exists to prove: company A's own
    // billing detail must never contain company B's billing account id,
    // organization id, or provider customer id anywhere in its output.
    expect(JSON.stringify(viewA.billing)).not.toContain(billingAccountBId);
    expect(JSON.stringify(viewA.billing)).not.toContain(linkedOrgBId);
  });

  it("a caller without billing.readPlatform/crm.pipeline.read/crm.onboarding.read sees those sections as null — not partial/degraded data", async () => {
    const owner = await makeActor("platform_owner", roleByKey.platform_owner!.id, `customer-360-owner2-${generateId()}@example.com`);
    const { companyId } = await makeCompanyConvertedTo(`Customer 360 Sec Narrow Co ${generateId()}`);

    const narrowRoleId = await makeCrmReadOnlyRole();
    await makeActor(`customer-360-crm-read-only`, narrowRoleId, `customer-360-narrow-${generateId()}@example.com`);
    void owner;

    const { getCustomer360 } = await import("@/server/services/customer-360-service");
    const view = await getCustomer360({ companyId });

    expect(view.company.id).toBe(companyId); // the crm.read floor still works
    // Basic linked-organization identity is CRM-domain data (consistent
    // with Build 23's own onboarding-page precedent — see
    // customer-360-service.ts's own comment) and stays visible under
    // crm.read alone...
    expect(view.linkedOrganization?.id).toBeDefined();
    // ...but the membership-count aggregate is a genuinely separate,
    // more sensitive piece of information (Codex Security Engineer
    // finding C360-01) and requires `organizations.read`, which this
    // narrow role does not hold.
    expect(view.linkedOrganizationMemberCounts).toBeNull();
    expect(view.canSeeSales).toBe(false);
    expect(view.deals).toBeNull();
    expect(view.proposals).toBeNull();
    expect(view.contracts).toBeNull();
    expect(view.canSeeOnboarding).toBe(false);
    expect(view.onboardings).toBeNull();
    expect(view.canSeeBilling).toBe(false);
    expect(view.billing).toBeNull();
  });

  it("rejects a forged/nonexistent companyId with NotFoundError, never a partial view", async () => {
    await makeActor("platform_owner", roleByKey.platform_owner!.id, `customer-360-owner3-${generateId()}@example.com`);
    const { getCustomer360 } = await import("@/server/services/customer-360-service");
    await expect(getCustomer360({ companyId: "00000000-0000-7000-8000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
