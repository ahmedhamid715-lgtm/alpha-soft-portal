import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * Regression coverage for the four CONFIRMED findings from Build 20's
 * Phase 5 Codex security review (see `crm-deal-service.ts`'s own
 * `assertOwnedPipelineAndStage()`/`currencyCodeSchema` comments,
 * `crm-pipeline-stage-service.ts`'s own `updateStage()` comment, and
 * `crm-deal-repository.ts`'s own `weightedForecastByCurrency()` comment
 * for what each fix actually does). Same `vi.mock("@/lib/auth/session-
 * guard")` + real-DB pattern `crm-security-fixes.test.ts` (Build 19)
 * already establishes.
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

describe.skipIf(!isDatabaseConfigured)("Sales Pipeline application-layer security fixes (database integration)", () => {
  const userIds: string[] = [];
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const companyIds: string[] = [];
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
    platformOrgId = (await organizationRepository.findPlatformOrganization())!.id;
  });

  afterEach(async () => {
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    pipelineIds.length = 0;
    stageIds.length = 0;
    dealIds.length = 0;
    companyIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makePlatformAdmin(email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey.platform_admin;
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId, role: "platform_admin" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "platform_admin", roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  async function seedCompany() {
    const company = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
      tx.crmCompany.create({ data: { id: generateId(), organizationId: platformOrgId, name: "Sales Pipeline Fix Test Company" } }),
    );
    companyIds.push(company.id);
    return company;
  }

  async function seedPipelineWithStage(stageOverrides: { isWon?: boolean; isLost?: boolean } = {}) {
    const pipeline = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
      tx.crmPipeline.create({ data: { id: generateId(), organizationId: platformOrgId, name: `Fix Test Pipeline ${generateId()}` } }),
    );
    pipelineIds.push(pipeline.id);
    const stage = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
      tx.crmPipelineStage.create({ data: { id: generateId(), organizationId: platformOrgId, pipelineId: pipeline.id, name: "Fix Test Stage", ...stageOverrides } }),
    );
    stageIds.push(stage.id);
    return { pipeline, stage };
  }

  describe("archived pipeline/stage rejected as an operational target (Finding 1 — MEDIUM)", () => {
    it("rejects creating a deal directly in an archived stage", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin1@example.com");
      actAs(admin.userId, admin.membership);
      const { pipeline, stage } = await seedPipelineWithStage();
      const company = await seedCompany();
      await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) => tx.crmPipelineStage.update({ where: { id: stage.id }, data: { status: "ARCHIVED" } }));

      const { createDeal } = await import("@/server/services/crm-deal-service");
      await expect(createDeal({ pipelineId: pipeline.id, stageId: stage.id, companyId: company.id, title: "Test deal" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects moving a deal into a just-archived stage", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin2@example.com");
      actAs(admin.userId, admin.membership);
      const { pipeline, stage: stageA } = await seedPipelineWithStage();
      const stageB = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
        tx.crmPipelineStage.create({ data: { id: generateId(), organizationId: platformOrgId, pipelineId: pipeline.id, name: "Second Stage", sortOrder: 2000 } }),
      );
      stageIds.push(stageB.id);
      const company = await seedCompany();

      const { createDeal, moveDealStage } = await import("@/server/services/crm-deal-service");
      const deal = await createDeal({ pipelineId: pipeline.id, stageId: stageA.id, companyId: company.id, title: "Test deal" });
      dealIds.push(deal.id);

      await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) => tx.crmPipelineStage.update({ where: { id: stageB.id }, data: { status: "ARCHIVED" } }));
      await expect(moveDealStage({ dealId: deal.id, stageId: stageB.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects winning a deal into an archived Won stage even when explicitly requested", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin3@example.com");
      actAs(admin.userId, admin.membership);
      const { pipeline, stage: openStage } = await seedPipelineWithStage();
      const wonStage = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
        tx.crmPipelineStage.create({ data: { id: generateId(), organizationId: platformOrgId, pipelineId: pipeline.id, name: "Won Stage", sortOrder: 2000, isWon: true, status: "ARCHIVED" } }),
      );
      stageIds.push(wonStage.id);
      const company = await seedCompany();

      const { createDeal, winDeal } = await import("@/server/services/crm-deal-service");
      const deal = await createDeal({ pipelineId: pipeline.id, stageId: openStage.id, companyId: company.id, title: "Test deal" });
      dealIds.push(deal.id);

      await expect(winDeal({ dealId: deal.id, stageId: wonStage.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("stage isWon/isLost validated against merged state (Finding 2 — LOW)", () => {
    it("rejects an incremental update that would make an already-Lost stage also Won", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin4@example.com");
      actAs(admin.userId, admin.membership);
      const { stage } = await seedPipelineWithStage({ isLost: true });

      const { updateStage } = await import("@/server/services/crm-pipeline-stage-service");
      await expect(updateStage({ stageId: stage.id, isWon: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("weighted forecast handles large deal values without overflow (Finding 3 — LOW)", () => {
    it("does not throw for a large, legitimately-sized OPEN deal at 100% probability", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin5@example.com");
      actAs(admin.userId, admin.membership);
      const { pipeline, stage } = await seedPipelineWithStage();
      const company = await seedCompany();

      const { createDeal } = await import("@/server/services/crm-deal-service");
      const deal = await createDeal({ pipelineId: pipeline.id, stageId: stage.id, companyId: company.id, title: "Large deal", valueMinorUnits: 2_000_000_000, probability: 100 });
      dealIds.push(deal.id);

      const { getForecastSummary } = await import("@/server/services/crm-deal-forecast-service");
      const summary = await getForecastSummary({ pipelineId: pipeline.id });
      const usdTotal = summary.weightedForecast.find((t) => t.currency === "USD");
      expect(usdTotal?.totalMinorUnits).toBe(2_000_000_000);
    });
  });

  describe("currency format validation (Finding 4 — LOW)", () => {
    it("rejects a malformed currency code", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin6@example.com");
      actAs(admin.userId, admin.membership);
      const { pipeline, stage } = await seedPipelineWithStage();
      const company = await seedCompany();

      const { createDeal } = await import("@/server/services/crm-deal-service");
      await expect(createDeal({ pipelineId: pipeline.id, stageId: stage.id, companyId: company.id, title: "Bad currency deal", currency: "12!" })).rejects.toThrow();
    });

    it("normalizes a lowercase currency code to uppercase", async () => {
      const admin = await makePlatformAdmin("pipeline-fix-admin7@example.com");
      actAs(admin.userId, admin.membership);
      const { pipeline, stage } = await seedPipelineWithStage();
      const company = await seedCompany();

      const { createDeal } = await import("@/server/services/crm-deal-service");
      const deal = await createDeal({ pipelineId: pipeline.id, stageId: stage.id, companyId: company.id, title: "Lowercase currency deal", currency: "eur" });
      dealIds.push(deal.id);
      expect(deal.currency).toBe("EUR");
    });
  });
});
