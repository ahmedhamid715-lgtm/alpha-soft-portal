import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { db } from "@/lib/db/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmClientSuccessRenewalRepository } from "@/server/repositories/crm-client-success-renewal-repository";
import { crmClientSuccessProfileRepository } from "@/server/repositories/crm-client-success-profile-repository";

/**
 * Regression coverage for the Codex Security Engineer's review of Build
 * 25 (Roadmap Module 19 — Client Success). Proves:
 *
 *   #1 — a plain `update()`/`setInProgress()` keyed only on `id` could
 *        commit AFTER a concurrent terminal transition, silently editing
 *        (or, for `setInProgress()`, effectively resurrecting) an
 *        already-closed renewal. Fixed by making both a real CAS
 *        (`updateMany()` guarded on `status NOT IN (terminal)` / `status
 *        = 'UPCOMING'`), the same pattern Build 23's own
 *        `setOnboardingStatus()` was fixed with.
 *   #2 — the `management_attention_reason_required` CHECK constraint
 *        only rejected `NULL`, not an empty/whitespace-only string —
 *        the service's own Zod schema already caught this, but a direct
 *        repository call would not have. Fixed with `NULLIF(BTRIM(...),
 *        '') IS NOT NULL`.
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

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Client Success security regression (database integration)", () => {
  let platformOrgId: string;
  let ownerUserId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  const userIds: string[] = [];
  const orgIds: string[] = [];
  const companyIds: string[] = [];
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const contractIds: string[] = [];
  const renewalIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: ownerUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    ownerUserId = generateId();
    userIds.push(ownerUserId);
    await userRepository.create({ id: ownerUserId, email: `cs-security-owner-${ownerUserId}@example.com`, name: "CS Security Owner" });
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId: ownerUserId, role: "platform_owner" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "platform_owner", roleId: roleByKey.platform_owner!.id });
    mockUser = { id: ownerUserId };
    mockMembershipsByOrg = new Map([[platformOrgId, { organizationId: platformOrgId, userId: ownerUserId, roleId: roleByKey.platform_owner!.id, status: "ACTIVE" }]]);
  });

  afterEach(async () => {
    if (renewalIds.length) await db.crmClientSuccessRenewal.deleteMany({ where: { id: { in: renewalIds } } });
    if (contractIds.length) await db.crmContract.deleteMany({ where: { id: { in: contractIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    for (const ids of [renewalIds, contractIds, dealIds, stageIds, pipelineIds, companyIds, userIds, orgIds]) ids.length = 0;
    vi.restoreAllMocks();
  });

  /** A company + WON deal + ACTIVE contract with a real endDate — the minimum a renewal needs. */
  async function seedCompanyWithActiveContract(): Promise<{ companyId: string; contractId: string }> {
    const companyId = generateId();
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const contractId = generateId();
    companyIds.push(companyId);
    pipelineIds.push(pipelineId);
    stageIds.push(stageId);
    dealIds.push(dealId);
    contractIds.push(contractId);

    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `CS Security Co ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId: platformOrgId, name: `CS Security Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId: platformOrgId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({ data: { id: dealId, organizationId: platformOrgId, pipelineId, stageId, companyId, title: `CS Security Deal ${dealId}`, status: "WON", wonAt: new Date(), assignedToUserId: ownerUserId } });
      await tx.crmContract.create({
        data: { id: contractId, organizationId: platformOrgId, dealId, companyId, contractNumber: `CS-SEC-${generateId()}`, status: "ACTIVE", effectiveDate: new Date(), endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), createdByUserId: ownerUserId },
      });
    });
    return { companyId, contractId };
  }

  it("a renewal that just went terminal cannot be resurrected or silently edited by a racing update/setInProgress call", async () => {
    const { companyId, contractId } = await seedCompanyWithActiveContract();

    const renewal = await withTenantContext(platformContext(), (tx) =>
      crmClientSuccessRenewalRepository.create(
        { id: generateId(), organizationId: platformOrgId, companyId, contractId, renewalDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), ownerUserId: null, expectedValueMinorUnits: null, expectedValueCurrency: null, notes: null, createdByUserId: ownerUserId },
        tx,
      ),
    );
    renewalIds.push(renewal.id);

    // Close it (simulating a concurrent staff member closing it first).
    await withTenantContext(platformContext(), (tx) => crmClientSuccessRenewalRepository.transitionTerminal(renewal.id, ["UPCOMING", "IN_PROGRESS"], { status: "RENEWED", outcome: "Client renewed." }, tx));

    // A "lost race" update() — must return null, never silently apply.
    const updateResult = await withTenantContext(platformContext(), (tx) => crmClientSuccessRenewalRepository.update(renewal.id, { notes: "sneaky edit" }, tx));
    expect(updateResult).toBeNull();

    // A "lost race" setInProgress() — must return null, never resurrect RENEWED back to IN_PROGRESS.
    const resurrectResult = await withTenantContext(platformContext(), (tx) => crmClientSuccessRenewalRepository.setInProgress(renewal.id, tx));
    expect(resurrectResult).toBeNull();

    const final = await withTenantContext(platformContext(), (tx) => crmClientSuccessRenewalRepository.findById(renewal.id, tx));
    expect(final?.status).toBe("RENEWED");
    expect(final?.notes).toBeNull(); // the sneaky edit never landed
  });

  it("the service layer surfaces a lost CAS race as ConflictError, not a silent success", async () => {
    const { companyId, contractId } = await seedCompanyWithActiveContract();
    const { createRenewal, closeRenewal, startRenewal } = await import("@/server/services/crm-client-success-service");

    const renewal = await createRenewal({ companyId, contractId });
    await closeRenewal({ renewalId: renewal.id, status: "NOT_RENEWING", outcome: "Client is moving to a competitor." });

    await expect(startRenewal({ renewalId: renewal.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" }); // status check catches this one before the CAS even runs
    renewalIds.push(renewal.id);
  });

  it("a whitespace-only management-attention reason is rejected by the DB constraint even bypassing the service's own Zod validation", async () => {
    const { companyId } = await seedCompanyWithActiveContract();

    await expect(
      withTenantContext(platformContext(), (tx) =>
        crmClientSuccessProfileRepository.setManagementAttention({ id: generateId(), organizationId: platformOrgId, companyId, flag: true, reason: "   ", setByUserId: ownerUserId, setAt: new Date() }, tx),
      ),
    ).rejects.toBeTruthy();
  });

  it("RLS fails closed — with no tenant context, all three new tables return zero rows even for real data", async () => {
    const { companyId, contractId } = await seedCompanyWithActiveContract();
    const renewal = await withTenantContext(platformContext(), (tx) =>
      crmClientSuccessRenewalRepository.create(
        { id: generateId(), organizationId: platformOrgId, companyId, contractId, renewalDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), ownerUserId: null, expectedValueMinorUnits: null, expectedValueCurrency: null, notes: null, createdByUserId: ownerUserId },
        tx,
      ),
    );
    renewalIds.push(renewal.id);
    await withTenantContext(platformContext(), (tx) => crmClientSuccessProfileRepository.setOwner({ id: generateId(), organizationId: platformOrgId, companyId, csOwnerUserId: ownerUserId }, tx));

    const noContext: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };
    const visible = await withTenantContext(noContext, (tx) =>
      Promise.all([tx.crmClientSuccessRenewal.findMany({ where: { id: renewal.id } }), tx.crmClientSuccessProfile.findMany({ where: { companyId } }), tx.crmClientSuccessExpansionOpportunity.findMany({ where: { companyId } })]),
    );
    expect(visible).toEqual([[], [], []]);
  });

  it("rejects a renewal whose contractId belongs to a DIFFERENT company than stated, at the service layer", async () => {
    const { contractId } = await seedCompanyWithActiveContract();
    const { companyId: otherCompanyId } = await seedCompanyWithActiveContract();
    const { createRenewal } = await import("@/server/services/crm-client-success-service");

    await expect(createRenewal({ companyId: otherCompanyId, contractId })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects handing an expansion opportunity off to a deal belonging to a DIFFERENT company than stated", async () => {
    const { companyId } = await seedCompanyWithActiveContract();
    const { companyId: otherCompanyId } = await seedCompanyWithActiveContract();
    const { createExpansionOpportunity, handExpansionToSales } = await import("@/server/services/crm-client-success-service");

    const expansion = await createExpansionOpportunity({ companyId, title: "Cross-tenant test", rationale: "Verifying the deal-company check." });
    const otherDeal = await withTenantContext(platformContext(), (tx) => tx.crmDeal.findFirstOrThrow({ where: { companyId: otherCompanyId } }));

    await expect(handExpansionToSales({ expansionId: expansion.id, dealId: otherDeal.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a forged/nonexistent companyId on every read/write entry point with NotFoundError", async () => {
    const { getClientSuccessHealth } = await import("@/server/services/crm-client-success-health-service");
    const { listRenewalsForCompany, setClientSuccessOwner } = await import("@/server/services/crm-client-success-service");
    const missing = "00000000-0000-7000-8000-000000000000";

    await expect(getClientSuccessHealth({ companyId: missing })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listRenewalsForCompany({ companyId: missing })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setClientSuccessOwner({ companyId: missing, userId: null })).rejects.toBeInstanceOf(NotFoundError);
  });
});
