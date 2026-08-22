import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * `plan-service.ts` (Module 13) — the internal plan catalog. `Plan`/
 * `PlanPrice` have no RLS (platform-wide reference data — see
 * billing-data-model.md), so this file's own security surface is
 * entirely the `billing.plan.manage` (write, platform-only) vs.
 * `billing.read` (customer-facing read) permission split, plus the
 * money-conversion boundary (`toMinorUnits`) and duplicate-key
 * rejection.
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

describe.skipIf(!isDatabaseConfigured)("plan-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Plan Test Org A", displayName: "Plan Test Org A", slug: `plan-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    planIds.length = 0;
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

  it("platform_owner can create a plan and a price; the price's unitAmount is converted from major to minor units server-side", async () => {
    const owner = await makeMember(platformOrgId, "platform_owner", "plan-create-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { createPlan, createPlanPrice } = await import("@/server/services/plan-service");

    const key = `test_plan_${generateId().replace(/-/g, "_")}`;
    const plan = await createPlan({ key, name: "Test Plan" });
    planIds.push(plan.id);
    expect(plan.active).toBe(true);

    const price = await createPlanPrice({ planId: plan.id, currency: "USD", unitAmountMajor: 99.99, interval: "MONTH" });
    expect(price.unitAmount).toBe(9999); // $99.99 -> 9999 minor units, never a float
  });

  it("platform_admin (holds billing.plan.manage) can also manage the catalog", async () => {
    const admin = await makeMember(platformOrgId, "platform_admin", "plan-create-admin@example.com");
    actAs(admin.userId, admin.membership);
    const { createPlan } = await import("@/server/services/plan-service");

    const plan = await createPlan({ key: `tp_admin_${generateId().replace(/-/g, "_")}`, name: "Admin-Created Plan" });
    planIds.push(plan.id);
    expect(plan.name).toBe("Admin-Created Plan");
  });

  it("support_admin (holds billing.readPlatform, NOT billing.plan.manage) cannot create a plan", async () => {
    const support = await makeMember(platformOrgId, "support_admin", "plan-create-support@example.com");
    actAs(support.userId, support.membership);
    const { createPlan } = await import("@/server/services/plan-service");

    await expect(createPlan({ key: `tp_support_${generateId().replace(/-/g, "_")}`, name: "Should Fail" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an organization owner (not platform staff) cannot manage the plan catalog", async () => {
    const owner = await makeMember(orgAId, "owner", "plan-create-org-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { createPlan } = await import("@/server/services/plan-service");

    await expect(createPlan({ key: `test_plan_org_${generateId().replace(/-/g, "_")}`, name: "Should Fail" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("creating a plan with a duplicate key is rejected", async () => {
    const owner = await makeMember(platformOrgId, "platform_owner", "plan-dup-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { createPlan } = await import("@/server/services/plan-service");

    const key = `dup_plan_${generateId().replace(/-/g, "_")}`;
    const plan = await createPlan({ key, name: "Original" });
    planIds.push(plan.id);
    await expect(createPlan({ key, name: "Duplicate" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("listActivePlans (billing.read) exposes only ACTIVE plans with only ACTIVE prices — never a deactivated plan or a legacy price", async () => {
    const platformOwner = await makeMember(platformOrgId, "platform_owner", "plan-list-platform@example.com");
    actAs(platformOwner.userId, platformOwner.membership);
    const { createPlan, createPlanPrice, updatePlan, updatePlanPrice, listActivePlans } = await import("@/server/services/plan-service");

    const activePlan = await createPlan({ key: `active_plan_${generateId().replace(/-/g, "_")}`, name: "Active Plan" });
    planIds.push(activePlan.id);
    const activePrice = await createPlanPrice({ planId: activePlan.id, currency: "USD", unitAmountMajor: 10, interval: "MONTH" });
    const legacyPrice = await createPlanPrice({ planId: activePlan.id, currency: "USD", unitAmountMajor: 5, interval: "MONTH" });
    await updatePlanPrice({ id: legacyPrice.id, active: false });

    const inactivePlan = await createPlan({ key: `inactive_plan_${generateId().replace(/-/g, "_")}`, name: "Inactive Plan" });
    planIds.push(inactivePlan.id);
    await createPlanPrice({ planId: inactivePlan.id, currency: "USD", unitAmountMajor: 20, interval: "MONTH" });
    await updatePlan({ id: inactivePlan.id, active: false });

    const orgOwner = await makeMember(orgAId, "owner", "plan-list-org-owner@example.com");
    actAs(orgOwner.userId, orgOwner.membership);
    const catalog = await listActivePlans({ organizationId: orgAId });

    const activeInCatalog = catalog.find((p) => p.id === activePlan.id);
    expect(activeInCatalog).toBeDefined();
    expect(activeInCatalog!.prices.map((p) => p.id)).toEqual([activePrice.id]); // legacy (deactivated) price excluded
    expect(catalog.find((p) => p.id === inactivePlan.id)).toBeUndefined(); // deactivated plan excluded entirely
  });

  it("a member without billing.read cannot view the catalog", async () => {
    const member = await makeMember(orgAId, "member", "plan-list-member@example.com");
    actAs(member.userId, member.membership);
    const { listActivePlans } = await import("@/server/services/plan-service");
    await expect(listActivePlans({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
