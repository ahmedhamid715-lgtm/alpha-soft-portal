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
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingChecklistItemRepository } from "@/server/repositories/crm-client-onboarding-checklist-item-repository";
import { crmClientOnboardingIntakeFieldRepository } from "@/server/repositories/crm-client-onboarding-intake-field-repository";
import { crmClientOnboardingIntakeResponseRepository } from "@/server/repositories/crm-client-onboarding-intake-response-repository";

/**
 * Regression coverage for the Codex Security Engineer's adversarial
 * review of Build 23 (Roadmap Module 17 — Client Onboarding). Proves the
 * fixes for:
 *
 *   #1 — a status update could resurrect a just-completed/cancelled
 *        onboarding (no CAS on the write itself).
 *   #2 — terminal onboardings remained mutable through nearly every
 *        direct action (requirements/checklist/documents/intake/
 *        assignments never checked the parent's own terminal status).
 *   #3 — `completeOnboarding()` evaluated completion criteria and then
 *        wrote the CAS transition as two separate steps, with nothing
 *        preventing a concurrent child-record mutation from committing
 *        in between and invalidating the criteria the write relied on.
 *
 * All three close through the SAME mechanism — see
 * `crm-client-onboarding-service.ts`'s own `lockActiveOnboarding()`
 * comment — so they are proven together rather than as three unrelated
 * unit tests.
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

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Client Onboarding security regression (database integration)", () => {
  let platformOrgId: string;
  let linkedOrgId: string;
  let ownerUserId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  const userIds: string[] = [];
  const orgIds: string[] = [];
  const companyIds: string[] = [];
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const proposalIds: string[] = [];
  const onboardingIds: string[] = [];

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
    await userRepository.create({ id: ownerUserId, email: `onboarding-security-owner-${ownerUserId}@example.com`, name: "Onboarding Security Owner" });
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId: ownerUserId, role: "platform_owner" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "platform_owner", roleId: roleByKey.platform_owner!.id });
    mockUser = { id: ownerUserId };
    mockMembershipsByOrg = new Map([[platformOrgId, { organizationId: platformOrgId, userId: ownerUserId, roleId: roleByKey.platform_owner!.id, status: "ACTIVE" }]]);

    linkedOrgId = generateId();
    orgIds.push(linkedOrgId);
    await organizationRepository.create({ id: linkedOrgId, name: `Onboarding Security Linked ${linkedOrgId}`, displayName: "Linked Customer", slug: `onboarding-security-linked-${linkedOrgId}` });
  });

  afterEach(async () => {
    if (onboardingIds.length) await db.crmClientOnboarding.deleteMany({ where: { id: { in: onboardingIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    for (const ids of [onboardingIds, proposalIds, dealIds, stageIds, pipelineIds, companyIds, userIds, orgIds]) ids.length = 0;
    vi.restoreAllMocks();
  });

  /**
   * A fresh onboarding under the real platform organization, with one
   * required checklist item — either left PENDING or pre-completed, per
   * the caller's need. No requirements or documents, so those gates are
   * vacuously satisfied, and kickoff is never scheduled (also vacuously
   * satisfied). The tenant-wide intake CATALOG is real and shared with
   * the dev seed fixture (`prisma/seed-client-onboarding.ts`), so any
   * currently-ACTIVE required field is answered here too — otherwise
   * every completion in this suite would fail on an unrelated "unmet:
   * INTAKE" gate that has nothing to do with what each test is proving.
   */
  async function seedOnboardingWithChecklistItem(checklistStatus: "PENDING" | "COMPLETE"): Promise<{ onboardingId: string; checklistItemId: string }> {
    const companyId = generateId();
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const proposalId = generateId();
    companyIds.push(companyId);
    pipelineIds.push(pipelineId);
    stageIds.push(stageId);
    dealIds.push(dealId);
    proposalIds.push(proposalId);

    const { onboardingId, checklistItemId } = await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `Onboarding Security Co ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      const linked = await crmCompanyRepository.linkToOrganization(companyId, linkedOrgId, tx);
      if (!linked) throw new Error("seed: expected the company-to-organization link to succeed");
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId: platformOrgId, name: `Onboarding Security Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId: platformOrgId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({ data: { id: dealId, organizationId: platformOrgId, pipelineId, stageId, companyId, title: `Onboarding Security Deal ${dealId}`, status: "WON", wonAt: new Date(), assignedToUserId: ownerUserId } });
      await crmProposalRepository.create({ id: proposalId, organizationId: platformOrgId, dealId, companyId, primaryContactId: null, proposalNumber: `ONBOARD-SEC-${generateId()}`, templateId: null, assignedToUserId: ownerUserId }, tx);

      const onboarding = await crmClientOnboardingRepository.create(
        { id: generateId(), organizationId: platformOrgId, dealId, companyId, linkedOrganizationId: linkedOrgId, originatingContractId: null, originatingProposalId: proposalId, createdByUserId: ownerUserId },
        tx,
      );
      const checklistItem = await crmClientOnboardingChecklistItemRepository.create(
        { id: generateId(), organizationId: platformOrgId, onboardingId: onboarding.id, title: "Confirm scope with client", description: null, required: true, assignedToUserId: null, dueDate: null, sortOrder: 0 },
        tx,
      );
      if (checklistStatus === "COMPLETE") {
        const completed = await crmClientOnboardingChecklistItemRepository.complete(checklistItem.id, tx);
        if (!completed) throw new Error("seed: expected the checklist item CAS-complete to succeed");
      }

      const activeFields = await crmClientOnboardingIntakeFieldRepository.listForOrganization(platformOrgId, "ACTIVE", tx);
      for (const field of activeFields.filter((f) => f.required)) {
        await crmClientOnboardingIntakeResponseRepository.upsert(
          { organizationId: platformOrgId, onboardingId: onboarding.id, fieldId: field.id, value: "Regression test response", respondedByUserId: ownerUserId },
          tx,
        );
      }

      return { onboardingId: onboarding.id, checklistItemId: checklistItem.id };
    });

    onboardingIds.push(onboardingId);
    return { onboardingId, checklistItemId };
  }

  describe("terminal-state guard on every mutation (finding #2)", () => {
    it("rejects setOnboardingStatus, kickoff, requirement/checklist/document/intake mutations, and assignment on an already-COMPLETED onboarding", async () => {
      const { onboardingId, checklistItemId } = await seedOnboardingWithChecklistItem("COMPLETE");
      const { completeOnboarding, setOnboardingStatus, scheduleKickoff, assignOnboardingRole } = await import("@/server/services/crm-client-onboarding-service");
      const { createRequirement, createChecklistItem, reopenChecklistItem, createDocumentRequest } = await import("@/server/services/crm-client-onboarding-checklist-service");
      const { recordIntakeResponse } = await import("@/server/services/crm-client-onboarding-intake-service");

      const completed = await completeOnboarding({ onboardingId });
      expect(completed.status).toBe("COMPLETED");

      const secondUserId = generateId();
      userIds.push(secondUserId);
      await userRepository.create({ id: secondUserId, email: `onboarding-security-assignee-${secondUserId}@example.com`, name: "Onboarding Security Assignee" });
      const secondMembership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId: secondUserId, role: "platform_admin" });
      await membershipRepository.updateRoleAssignment(secondMembership.id, { role: "platform_admin", roleId: roleByKey.platform_admin!.id });

      const attempts: Promise<unknown>[] = [
        setOnboardingStatus({ onboardingId, status: "BLOCKED" }),
        scheduleKickoff({ onboardingId, scheduledAt: new Date(Date.now() + 86_400_000) }),
        createRequirement({ onboardingId, title: "New requirement" }),
        createChecklistItem({ onboardingId, title: "New checklist item" }),
        reopenChecklistItem({ checklistItemId }),
        createDocumentRequest({ onboardingId, title: "New document" }),
        recordIntakeResponse({ onboardingId, fieldId: generateId(), value: "anything" }),
        assignOnboardingRole({ onboardingId, role: "ACCOUNT_MANAGER", userId: secondUserId }),
      ];

      const results = await Promise.allSettled(attempts);
      // Every one of the 8 paths reaches the SAME shared
      // `lockActiveOnboarding()` guard before doing anything else, and
      // every one reports the identical terminal-state message — proving
      // the guard is genuinely shared, not eight independent copies that
      // could drift or be missed on one path.
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(String((result.reason as Error)?.message ?? result.reason)).toMatch(/terminal state/);
        }
      }

      const finalOnboarding = await withTenantContext(platformContext(), (tx) => crmClientOnboardingRepository.findById(onboardingId, tx));
      expect(finalOnboarding?.status).toBe("COMPLETED"); // never resurrected or silently mutated
    });
  });

  describe("completion criteria cannot go stale between evaluation and write (finding #3, closes finding #1 the same way)", () => {
    it("completeOnboarding() racing a concurrent reopenChecklistItem() on the only required item never ends up COMPLETED with that item PENDING", async () => {
      const { onboardingId, checklistItemId } = await seedOnboardingWithChecklistItem("COMPLETE");
      const { completeOnboarding } = await import("@/server/services/crm-client-onboarding-service");
      const { reopenChecklistItem } = await import("@/server/services/crm-client-onboarding-checklist-service");

      const results = await Promise.allSettled([completeOnboarding({ onboardingId }), reopenChecklistItem({ checklistItemId })]);

      const finalOnboarding = await withTenantContext(platformContext(), (tx) => crmClientOnboardingRepository.findById(onboardingId, tx));
      const finalChecklistItem = await withTenantContext(platformContext(), (tx) => crmClientOnboardingChecklistItemRepository.findById(checklistItemId, tx));

      if (finalOnboarding?.status === "COMPLETED") {
        // completeOnboarding won the row lock first: its own criteria
        // read is guaranteed final, so the required item it relied on
        // must still be COMPLETE, and the reopen must have been rejected
        // once it saw the now-terminal onboarding.
        expect(finalChecklistItem?.status).toBe("COMPLETE");
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      } else {
        // The reopen won the row lock first: completeOnboarding's own
        // criteria read then correctly observed the item as PENDING
        // again and refused to complete.
        expect(finalChecklistItem?.status).toBe("PENDING");
        expect(finalOnboarding?.status).not.toBe("COMPLETED");
      }
      // The one invariant that must ALWAYS hold regardless of which side
      // won the race — this is what finding #3 says the old code could
      // violate: a COMPLETED onboarding with a required item left PENDING.
      const inconsistent = finalOnboarding?.status === "COMPLETED" && finalChecklistItem?.status !== "COMPLETE";
      expect(inconsistent).toBe(false);
    });

    it("two SIMULTANEOUS completeOnboarding() calls on the same onboarding: exactly one succeeds, never a double-complete (finding #1)", async () => {
      const { onboardingId } = await seedOnboardingWithChecklistItem("COMPLETE");
      const { completeOnboarding } = await import("@/server/services/crm-client-onboarding-service");

      const results = await Promise.allSettled([completeOnboarding({ onboardingId }), completeOnboarding({ onboardingId })]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/terminal state/);

      const finalOnboarding = await withTenantContext(platformContext(), (tx) => crmClientOnboardingRepository.findById(onboardingId, tx));
      expect(finalOnboarding?.status).toBe("COMPLETED");
    });

    it("setOnboardingStatus() cannot resurrect an onboarding a concurrent completeOnboarding() just completed", async () => {
      const { onboardingId } = await seedOnboardingWithChecklistItem("COMPLETE");
      const { completeOnboarding, setOnboardingStatus } = await import("@/server/services/crm-client-onboarding-service");

      const results = await Promise.allSettled([completeOnboarding({ onboardingId }), setOnboardingStatus({ onboardingId, status: "BLOCKED" })]);

      const finalOnboarding = await withTenantContext(platformContext(), (tx) => crmClientOnboardingRepository.findById(onboardingId, tx));
      // Whichever ran first, the final state must be one of the two
      // legitimate outcomes — COMPLETED (status-set lost the race and was
      // rejected as terminal) or BLOCKED (status-set won and completed
      // then correctly failed as a lost CAS) — never a resurrection where
      // COMPLETED silently reverts to BLOCKED after having been reached.
      expect(["COMPLETED", "BLOCKED"]).toContain(finalOnboarding?.status);
      if (finalOnboarding?.status === "BLOCKED") {
        // If status-set won, completeOnboarding must have been the one
        // rejected — a genuinely completed row is never left as BLOCKED.
        const completeResult = results[0];
        expect(completeResult.status).toBe("rejected");
      }
    });
  });
});
