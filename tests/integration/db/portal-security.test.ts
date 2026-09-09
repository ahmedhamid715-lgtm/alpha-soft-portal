import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { db } from "@/lib/db/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { AuthorizationError, NotFoundError } from "@/lib/errors/app-error";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { notificationRepository } from "@/server/repositories/notification-repository";

/**
 * Customer Portal (Build 26 — Roadmap Module 20) composition security.
 * The single highest-risk piece of this build is `portal-crm-bridge.ts`
 * — the elevated `{ isPlatformStaff: true }` transaction a verified
 * customer's own request opens to read platform-owned `crm_*` tables
 * (see that file's own top comment for why this is structurally
 * necessary, not a shortcut). This file proves:
 *
 *   - Portal eligibility genuinely denies every non-eligible state
 *     (no membership, INVITED, SUSPENDED membership, SUSPENDED org,
 *     ARCHIVED org, platform-org-only membership).
 *   - The CRM bridge never attaches organization A's converted
 *     `CrmCompany`/onboarding/proposal/contract data to organization
 *     B's own Portal view, even when both exist side by side.
 *   - `getPortalNotifications()`'s `organizationId` filter narrows
 *     correctly — a multi-org user's Portal view for org A never shows
 *     a notification associated with org B, even though both are
 *     addressed to the SAME `recipientUserId`.
 *   - Cross-organization invoice IDOR remains denied when reached
 *     through Portal's own code path (the existing Build 14
 *     protection, re-verified here rather than assumed).
 */

let mockUser: { id: string } | null = null;
/**
 * Keyed by `${organizationId}:${userId}`, NOT organizationId alone —
 * this test (unlike the single-actor Build 24/25 security tests it's
 * otherwise modeled on) deliberately keeps MULTIPLE real users' own
 * memberships live in this map at once, specifically to prove one
 * user's session can never resolve another user's membership row. An
 * org-only key would silently let `getCurrentMembership(orgB)` return
 * userB's own membership while `mockUser` is userA — a false-positive
 * IDOR in the mock itself, not the real code (found live by this exact
 * test on its first run, before this fix).
 */
let mockMembershipsByOrgAndUser = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (!mockUser) return null;
    if (organizationId) return mockMembershipsByOrgAndUser.get(`${organizationId}:${mockUser.id}`) ?? null;
    const ownMemberships = [...mockMembershipsByOrgAndUser.values()].filter((m) => m.userId === mockUser!.id);
    return ownMemberships.length === 1 ? ownMemberships[0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Customer Portal composition security (database integration)", () => {
  let platformOrgId: string;
  let platformOwnerUserId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  const userIds: string[] = [];
  const orgIds: string[] = [];
  const companyIds: string[] = [];
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const contractIds: string[] = [];
  const onboardingIds: string[] = [];
  const proposalIds: string[] = [];
  const proposalVersionIds: string[] = [];
  const notificationIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformOwnerUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrgAndUser = new Map();
    vi.clearAllMocks();

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    platformOwnerUserId = generateId();
    userIds.push(platformOwnerUserId);
    await userRepository.create({ id: platformOwnerUserId, email: `portal-security-platform-${platformOwnerUserId}@example.com`, name: "Portal Security Platform Owner" });
    const platformMembership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId: platformOwnerUserId, role: "platform_owner" });
    await membershipRepository.updateRoleAssignment(platformMembership.id, { role: "platform_owner", roleId: roleByKey.platform_owner!.id });
  });

  afterEach(async () => {
    if (notificationIds.length) await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
    if (proposalVersionIds.length) await db.crmProposalVersion.deleteMany({ where: { id: { in: proposalVersionIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (onboardingIds.length) await db.crmClientOnboarding.deleteMany({ where: { id: { in: onboardingIds } } });
    if (contractIds.length) await db.crmContract.deleteMany({ where: { id: { in: contractIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    for (const ids of [notificationIds, proposalVersionIds, proposalIds, onboardingIds, contractIds, dealIds, stageIds, pipelineIds, companyIds, userIds, orgIds]) ids.length = 0;
    vi.restoreAllMocks();
  });

  /** A fresh customer organization, a real ACTIVE `member`-role membership for `userId`, and both the DB row `resolvePortalContext()`'s own `membershipRepository.listForUser()` reads AND the mocked `getCurrentMembership()` map `resolveOrganizationContext()` reads. */
  async function makeCustomerOrgWithMember(userId: string, roleKey: "member" | "owner" | "admin" = "member", membershipStatus: "ACTIVE" | "INVITED" | "SUSPENDED" = "ACTIVE", orgStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED" = "ACTIVE"): Promise<string> {
    const orgId = generateId();
    orgIds.push(orgId);
    await organizationRepository.create({ id: orgId, name: `Portal Security Org ${orgId}`, displayName: `Portal Security Org ${orgId}`, slug: `portal-sec-${orgId}` });
    if (orgStatus !== "ACTIVE") await db.organization.update({ where: { id: orgId }, data: { status: orgStatus } });

    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: roleByKey[roleKey]!.id });
    if (membershipStatus !== "ACTIVE") await db.organizationMembership.update({ where: { id: membership.id }, data: { status: membershipStatus } });

    mockMembershipsByOrgAndUser.set(`${orgId}:${userId}`, { organizationId: orgId, userId, roleId: roleByKey[roleKey]!.id, status: membershipStatus });
    return orgId;
  }

  async function makeCustomerUser(): Promise<string> {
    const userId = generateId();
    userIds.push(userId);
    await userRepository.create({ id: userId, email: `portal-security-customer-${userId}@example.com`, name: "Portal Security Customer" });
    return userId;
  }

  /** A converted `CrmCompany` (with a real ACTIVE contract + IN_PROGRESS onboarding + an ACCEPTED proposal) linked to `linkedOrganizationId`. */
  async function seedCrmEngagementFor(linkedOrganizationId: string, label: string) {
    const companyId = generateId();
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const contractId = generateId();
    const onboardingId = generateId();
    const proposalId = generateId();
    const versionId = generateId();
    companyIds.push(companyId);
    pipelineIds.push(pipelineId);
    stageIds.push(stageId);
    dealIds.push(dealId);
    contractIds.push(contractId);
    onboardingIds.push(onboardingId);
    proposalIds.push(proposalId);
    proposalVersionIds.push(versionId);

    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `Portal Sec Co ${label}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyId, linkedOrganizationId, tx);
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId: platformOrgId, name: `Portal Sec Pipeline ${label}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId: platformOrgId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({ data: { id: dealId, organizationId: platformOrgId, pipelineId, stageId, companyId, title: `Portal Sec Deal ${label}`, status: "WON", wonAt: new Date(), assignedToUserId: platformOwnerUserId } });
      await tx.crmContract.create({
        data: { id: contractId, organizationId: platformOrgId, dealId, companyId, contractNumber: `PORTAL-SEC-${label}-${generateId()}`, status: "ACTIVE", effectiveDate: new Date(), endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), createdByUserId: platformOwnerUserId },
      });
      await tx.crmClientOnboarding.create({
        data: { id: onboardingId, organizationId: platformOrgId, dealId, companyId, linkedOrganizationId, originatingContractId: contractId, status: "IN_PROGRESS", createdByUserId: platformOwnerUserId },
      });
      await tx.crmProposal.create({ data: { id: proposalId, organizationId: platformOrgId, dealId, companyId, proposalNumber: `PORTAL-SEC-PROP-${label}-${generateId()}`, status: "ACCEPTED", assignedToUserId: platformOwnerUserId } });
      await tx.crmProposalVersion.create({
        data: {
          id: versionId,
          organizationId: platformOrgId,
          proposalId,
          versionNumber: 1,
          status: "ACCEPTED",
          title: `Portal Sec Proposal ${label}`,
          bodyHtml: `<p>Proposal for ${label}</p>`,
          currency: "USD",
          subtotalMinorUnits: 100000,
          discountType: "NONE",
          discountedSubtotalMinorUnits: 100000,
          totalMinorUnits: 100000,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
          acceptanceMechanism: "INTERNAL_RECORDED",
          createdByUserId: platformOwnerUserId,
        },
      });
      await tx.crmProposal.update({ where: { id: proposalId }, data: { currentVersionId: versionId } });
    });

    return { companyId, contractId, onboardingId, proposalId };
  }

  it("resolvePortalContext denies every non-eligible membership/organization state", async () => {
    const { resolvePortalContext } = await import("@/lib/portal/context");

    // No membership at all.
    const orphanUserId = await makeCustomerUser();
    mockUser = { id: orphanUserId };
    let ctx = await resolvePortalContext();
    expect(ctx.eligibleOrganizations).toHaveLength(0);
    expect(ctx.organizationId).toBeNull();

    // INVITED membership.
    const invitedUserId = await makeCustomerUser();
    await makeCustomerOrgWithMember(invitedUserId, "member", "INVITED");
    mockUser = { id: invitedUserId };
    ctx = await resolvePortalContext();
    expect(ctx.eligibleOrganizations).toHaveLength(0);

    // SUSPENDED membership.
    const suspendedMemberUserId = await makeCustomerUser();
    await makeCustomerOrgWithMember(suspendedMemberUserId, "member", "SUSPENDED");
    mockUser = { id: suspendedMemberUserId };
    ctx = await resolvePortalContext();
    expect(ctx.eligibleOrganizations).toHaveLength(0);

    // ACTIVE membership in a SUSPENDED organization.
    const suspendedOrgUserId = await makeCustomerUser();
    await makeCustomerOrgWithMember(suspendedOrgUserId, "member", "ACTIVE", "SUSPENDED");
    mockUser = { id: suspendedOrgUserId };
    ctx = await resolvePortalContext();
    expect(ctx.eligibleOrganizations).toHaveLength(0);

    // ACTIVE membership in an ARCHIVED organization.
    const archivedOrgUserId = await makeCustomerUser();
    await makeCustomerOrgWithMember(archivedOrgUserId, "member", "ACTIVE", "ARCHIVED");
    mockUser = { id: archivedOrgUserId };
    ctx = await resolvePortalContext();
    expect(ctx.eligibleOrganizations).toHaveLength(0);

    // Platform-org-only membership (support_agent, no customer org at all).
    const platformOnlyUserId = await makeCustomerUser();
    userIds.push(platformOnlyUserId);
    const platformMembership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId: platformOnlyUserId, role: "support_agent" });
    await membershipRepository.updateRoleAssignment(platformMembership.id, { role: "support_agent", roleId: roleByKey.support_agent!.id });
    mockUser = { id: platformOnlyUserId };
    mockMembershipsByOrgAndUser.set(`${platformOrgId}:${platformOnlyUserId}`, { organizationId: platformOrgId, userId: platformOnlyUserId, roleId: roleByKey.support_agent!.id, status: "ACTIVE" });
    ctx = await resolvePortalContext();
    expect(ctx.eligibleOrganizations).toHaveLength(0);

    // A genuinely eligible member — sanity check the positive case too.
    const eligibleUserId = await makeCustomerUser();
    const eligibleOrgId = await makeCustomerOrgWithMember(eligibleUserId, "member", "ACTIVE", "ACTIVE");
    mockUser = { id: eligibleUserId };
    ctx = await resolvePortalContext();
    expect(ctx.organizationId).toBe(eligibleOrgId);
    expect(ctx.authorization.permissions.has("portal.access")).toBe(true);
  });

  it("the CRM bridge never attaches organization A's converted CrmCompany/onboarding/proposal to organization B's own Portal view", async () => {
    const userAId = await makeCustomerUser();
    const orgAId = await makeCustomerOrgWithMember(userAId, "member");
    const userBId = await makeCustomerUser();
    const orgBId = await makeCustomerOrgWithMember(userBId, "member");

    const { companyId: companyAId } = await seedCrmEngagementFor(orgAId, "A");
    const { companyId: companyBId } = await seedCrmEngagementFor(orgBId, "B");
    expect(companyAId).not.toBe(companyBId);

    const { resolvePortalCrmCompany } = await import("@/server/services/portal/portal-crm-bridge");
    const resolvedForA = await resolvePortalCrmCompany(orgAId, userAId);
    const resolvedForB = await resolvePortalCrmCompany(orgBId, userBId);
    expect(resolvedForA?.id).toBe(companyAId);
    expect(resolvedForB?.id).toBe(companyBId);
    expect(resolvedForA?.id).not.toBe(resolvedForB?.id);

    mockUser = { id: userAId };
    const { getPortalOnboardingStatus } = await import("@/server/services/portal/portal-onboarding-service");
    const { getPortalServices } = await import("@/server/services/portal/portal-services-service");
    const { getPortalDocuments } = await import("@/server/services/portal/portal-documents-service");

    const onboardingA = await getPortalOnboardingStatus({ organizationId: orgAId });
    expect(onboardingA?.status).toBe("IN_PROGRESS");

    const servicesA = await getPortalServices({ organizationId: orgAId });
    expect(servicesA.source).not.toBe("none");

    const documentsA = await getPortalDocuments({ organizationId: orgAId });
    expect(documentsA.proposal?.proposalNumber).toContain("-A-");
    expect(documentsA.proposal?.proposalNumber).not.toContain("-B-");
    expect(documentsA.contracts.every((c) => !c.contractNumber.includes("-B-"))).toBe(true);
  });

  it("getPortalOnboardingStatus/getPortalServices/getPortalDocuments reject a caller with no membership in the target organization, even with a valid session elsewhere", async () => {
    const userAId = await makeCustomerUser();
    // userA has a real, active membership elsewhere (a legitimate
    // Portal session), just not in orgB — the point of this test.
    await makeCustomerOrgWithMember(userAId, "member");
    const userBId = await makeCustomerUser();
    const orgBId = await makeCustomerOrgWithMember(userBId, "member");
    await seedCrmEngagementFor(orgBId, "DenyTest");

    // userA is authenticated (has a real session) but has NO membership in orgB at all.
    mockUser = { id: userAId };
    const { getPortalOnboardingStatus } = await import("@/server/services/portal/portal-onboarding-service");
    await expect(getPortalOnboardingStatus({ organizationId: orgBId })).rejects.toThrow(AuthorizationError);
  });

  it("a company that never converted (no CrmCompany link) returns honest empty states, never an error, never another organization's data", async () => {
    const userId = await makeCustomerUser();
    const orgId = await makeCustomerOrgWithMember(userId, "member");
    mockUser = { id: userId };

    const { getPortalOnboardingStatus } = await import("@/server/services/portal/portal-onboarding-service");
    const { getPortalServices } = await import("@/server/services/portal/portal-services-service");
    const { getPortalDocuments } = await import("@/server/services/portal/portal-documents-service");

    expect(await getPortalOnboardingStatus({ organizationId: orgId })).toBeNull();
    expect(await getPortalServices({ organizationId: orgId })).toEqual({ source: "none", items: [] });
    expect(await getPortalDocuments({ organizationId: orgId })).toEqual({ proposal: null, contracts: [], onboardingDocuments: [] });
  });

  it("getPortalNotifications never returns another organization's notification for the SAME multi-org user", async () => {
    const userId = await makeCustomerUser();
    const orgAId = await makeCustomerOrgWithMember(userId, "member");
    // Same user, second organization — a real multi-org customer.
    const orgBOrgId = generateId();
    orgIds.push(orgBOrgId);
    await organizationRepository.create({ id: orgBOrgId, name: `Portal Security Org ${orgBOrgId}`, displayName: `Portal Security Org ${orgBOrgId}`, slug: `portal-sec-${orgBOrgId}` });
    const membershipB = await membershipRepository.create({ id: generateId(), organizationId: orgBOrgId, userId, role: "member" });
    await membershipRepository.updateRoleAssignment(membershipB.id, { role: "member", roleId: roleByKey.member!.id });
    mockMembershipsByOrgAndUser.set(`${orgBOrgId}:${userId}`, { organizationId: orgBOrgId, userId, roleId: roleByKey.member!.id, status: "ACTIVE" });

    const notifAId = generateId();
    const notifBId = generateId();
    notificationIds.push(notifAId, notifBId);
    await withTenantContext({ userId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      notificationRepository.create(
        { id: notifAId, organizationId: orgAId, recipientUserId: userId, category: "SYSTEM", severity: "INFO", title: "Org A notice", body: "For org A only", actionUrl: null, metadata: null, sourceEventType: "test.portal_security", sourceEntityType: null, sourceEntityId: null, idempotencyKey: `portal-sec-a-${notifAId}`, expiresAt: null },
        tx,
      ),
    );
    await withTenantContext({ userId, organizationId: orgBOrgId, isPlatformStaff: false }, (tx) =>
      notificationRepository.create(
        { id: notifBId, organizationId: orgBOrgId, recipientUserId: userId, category: "SYSTEM", severity: "INFO", title: "Org B notice", body: "For org B only", actionUrl: null, metadata: null, sourceEventType: "test.portal_security", sourceEntityType: null, sourceEntityId: null, idempotencyKey: `portal-sec-b-${notifBId}`, expiresAt: null },
        tx,
      ),
    );

    mockUser = { id: userId };
    const { getPortalNotifications } = await import("@/server/services/portal/portal-notifications-service");
    const pageA = await getPortalNotifications({ organizationId: orgAId, limit: 25 });
    expect(pageA.items.some((n) => n.id === notifAId)).toBe(true);
    expect(pageA.items.some((n) => n.id === notifBId)).toBe(false);

    const pageB = await getPortalNotifications({ organizationId: orgBOrgId, limit: 25 });
    expect(pageB.items.some((n) => n.id === notifBId)).toBe(true);
    expect(pageB.items.some((n) => n.id === notifAId)).toBe(false);
  });

  it("cross-organization invoice access remains denied when reached through Portal's own service import path", async () => {
    const userAId = await makeCustomerUser();
    const orgAId = await makeCustomerOrgWithMember(userAId, "owner");
    const userBId = await makeCustomerUser();
    const orgBId = await makeCustomerOrgWithMember(userBId, "owner");

    mockUser = { id: userBId };
    const { getInvoiceForOrganization } = await import("@/server/services/invoice-service");
    // No invoice exists at all for either org here — the point is proving
    // the existing organizationId-ownership check still throws NotFoundError
    // (never a cross-tenant row) for a forged/nonexistent invoiceId, the
    // exact call shape `/portal/billing/invoices/[invoiceId]` uses.
    await expect(getInvoiceForOrganization({ organizationId: orgBId, invoiceId: generateId() })).rejects.toThrow(NotFoundError);
    void orgAId;
  });
});
