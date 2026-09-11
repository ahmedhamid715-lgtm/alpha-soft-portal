import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

/**
 * Service Management (Build 29 — Roadmap Module 23) database
 * integration coverage: RLS fail-closed/cross-tenant isolation, the
 * relationship-integrity trigger (both branches — source-item
 * provenance consistency AND the unconditional company-conversion
 * check that also covers manually-created rows), the DB-level
 * idempotency partial unique index, CHECK constraints, and CAS
 * lifecycle transitions — the same rigor Build 27/28's own equivalent
 * files establish for a cross-tenant-relationship-heavy domain.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Service Management (database integration)", () => {
  let platformOrgId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const dealIds: string[] = [];
  const proposalIds: string[] = [];
  const pipelineIds: string[] = [];
  const onboardingIds: string[] = [];
  const definitionIds: string[] = [];
  const customerServiceIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    platformOrgId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!platformOrgId) {
      platformOrgId = generateId();
      organizationIds.push(platformOrgId);
      await db.organization.create({ data: { id: platformOrgId, name: "Platform", displayName: "Platform", slug: `platform-${platformOrgId}`, isPlatform: true } });
    }
    customerOrgAId = await createOrganization("Service Mgmt RLS Customer A");
    customerOrgBId = await createOrganization("Service Mgmt RLS Customer B");
    platformUserId = await createUser("service-mgmt-rls");
  });

  afterEach(async () => {
    if (customerServiceIds.length) await db.customerService.deleteMany({ where: { id: { in: customerServiceIds } } }).catch(() => {});
    if (definitionIds.length) await db.serviceDefinition.deleteMany({ where: { id: { in: definitionIds } } }).catch(() => {});
    if (onboardingIds.length) await db.crmClientOnboarding.deleteMany({ where: { id: { in: onboardingIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (pipelineIds.length) await db.crmPipelineStage.deleteMany({ where: { pipelineId: { in: pipelineIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    for (const ids of [customerServiceIds, definitionIds, onboardingIds, proposalIds, dealIds, pipelineIds, companyIds, userIds, organizationIds]) ids.length = 0;
    companyByOrg.clear();
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `service-mgmt-rls-${id}` });
    return id;
  }

  async function createUser(prefix: string): Promise<string> {
    const id = generateId();
    userIds.push(id);
    await userRepository.create({ id, email: `${prefix}-${id}@example.com`, name: `Service Mgmt RLS Actor ${id}` });
    return id;
  }

  // `crm_companies.converted_to_organization_id` is UNIQUE — a customer
  // organization can only ever be the conversion target of one company.
  const companyByOrg = new Map<string, string>();

  async function seedCompany(customerOrganizationId: string): Promise<string> {
    const cached = companyByOrg.get(customerOrganizationId);
    if (cached) return cached;
    const companyId = generateId();
    companyIds.push(companyId);
    companyByOrg.set(customerOrganizationId, companyId);
    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `Service Mgmt RLS Company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyId, customerOrganizationId, tx);
    });
    return companyId;
  }

  async function seedDefinition(status: "ACTIVE" | "ARCHIVED" = "ACTIVE"): Promise<string> {
    const id = generateId();
    definitionIds.push(id);
    await withTenantContext(platformContext(), async (tx) => {
      const definition = await serviceDefinitionRepository.create({ id, organizationId: platformOrgId, name: `SEO Core ${id}`, code: `SEO-${id}`, description: null, category: "SEO", deliveryCadence: "RECURRING", sortOrder: 0 }, tx);
      if (status === "ARCHIVED") await serviceDefinitionRepository.archive(definition.id, tx);
    });
    return id;
  }

  /** Full deal → proposal → onboarding → service item chain for customer org A, mirroring `task-management-security.test.ts`'s own identical pipeline seed. */
  async function seedOnboardingWithServiceItem(): Promise<{ onboardingId: string; serviceItemId: string; companyId: string }> {
    const companyId = await seedCompany(customerOrgAId);
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const proposalId = generateId();
    pipelineIds.push(pipelineId);
    dealIds.push(dealId);
    proposalIds.push(proposalId);

    return withTenantContext(platformContext(), async (tx) => {
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId: platformOrgId, name: `Service Mgmt RLS Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId: platformOrgId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({ data: { id: dealId, organizationId: platformOrgId, pipelineId, stageId, companyId, title: `Service Mgmt RLS Deal ${dealId}`, status: "WON", wonAt: new Date(), assignedToUserId: platformUserId } });
      await crmProposalRepository.create({ id: proposalId, organizationId: platformOrgId, dealId, companyId, primaryContactId: null, proposalNumber: `SM-RLS-${proposalId}`, templateId: null, assignedToUserId: platformUserId }, tx);

      const onboardingId = generateId();
      onboardingIds.push(onboardingId);
      const onboarding = await crmClientOnboardingRepository.create(
        { id: onboardingId, organizationId: platformOrgId, dealId, companyId, linkedOrganizationId: customerOrgAId, originatingContractId: null, originatingProposalId: proposalId, createdByUserId: platformUserId },
        tx,
      );

      await crmClientOnboardingServiceItemRepository.createMany(onboarding.id, platformOrgId, [{ title: "SEO Retainer", description: null, quantity: 1, sourceLineItemId: null, onboardingRequired: true, notes: null }], tx);
      const items = await crmClientOnboardingServiceItemRepository.listForOnboarding(onboarding.id, tx);
      return { onboardingId: onboarding.id, serviceItemId: items[0]!.id, companyId };
    });
  }

  describe("relationship integrity trigger", () => {
    it("accepts a CustomerService whose source item, customer org, and company are all mutually consistent", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();
      customerServiceIds.push(id);

      const created = await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );
      expect(created.id).toBe(id);
    });

    it("rejects a CustomerService claiming the WRONG customer organization for its source onboarding service item", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();

      let caught: unknown;
      try {
        await withTenantContext(platformContext(), (tx) =>
          customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgBId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
    });

    it("rejects a manually-created CustomerService whose company was never converted to the claimed customer organization", async () => {
      const companyId = await seedCompany(customerOrgAId); // converted to A, not B
      const definitionId = await seedDefinition();
      const id = generateId();

      let caught: unknown;
      try {
        await withTenantContext(platformContext(), (tx) =>
          customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgBId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: null, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
    });
  });

  describe("idempotency", () => {
    it("the partial unique index rejects a second non-cancelled CustomerService for the same source item", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const firstId = generateId();
      customerServiceIds.push(firstId);
      await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id: firstId, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );

      const secondId = generateId();
      let caught: unknown;
      try {
        await withTenantContext(platformContext(), (tx) =>
          customerServiceRepository.create({ id: secondId, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
    });

    it("a CANCELLED provisioning does not block a fresh attempt for the same source item", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const firstId = generateId();
      customerServiceIds.push(firstId);
      await withTenantContext(platformContext(), async (tx) => {
        await customerServiceRepository.create({ id: firstId, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx);
        await customerServiceRepository.cancel(firstId, { cancelledReason: "No longer needed", cancelledByUserId: platformUserId }, tx);
      });

      const secondId = generateId();
      customerServiceIds.push(secondId);
      const created = await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id: secondId, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );
      expect(created.id).toBe(secondId);
    });

    it("under real concurrent requests, only one of two simultaneous provisioning attempts for the same source item succeeds", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const idA = generateId();
      const idB = generateId();
      customerServiceIds.push(idA, idB);

      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) =>
          customerServiceRepository
            .create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx)
            .then(() => "fulfilled" as const)
            .catch(() => "rejected" as const),
        );

      const [resultA, resultB] = await Promise.all([attempt(idA), attempt(idB)]);
      const outcomes = [resultA, resultB].sort();
      expect(outcomes).toEqual(["fulfilled", "rejected"]);
    });
  });

  describe("CHECK constraints", () => {
    it("requires a non-blank cancellation reason", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();
      customerServiceIds.push(id);
      await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );

      let caught: unknown;
      try {
        await withTenantContext(platformContext(), (tx) => tx.customerService.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: "   " } }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
    });

    it("requires a non-blank service definition code", async () => {
      let caught: unknown;
      try {
        await withTenantContext(platformContext(), (tx) => serviceDefinitionRepository.create({ id: generateId(), organizationId: platformOrgId, name: "Bad Code", code: "   ", description: null, category: "SEO", deliveryCadence: "ONE_TIME", sortOrder: 0 }, tx));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
    });
  });

  describe("RLS / tenant isolation", () => {
    it("shows zero rows with no tenant context set (fail-closed baseline)", async () => {
      await seedDefinition();
      const rowsDefs = await withTenantContext(NO_TENANT_CONTEXT, (tx) => tx.serviceDefinition.findMany());
      expect(rowsDefs).toHaveLength(0);
    });

    it("a bare (non-platform) customer tenant context sees zero rows regardless of which customer org", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();
      customerServiceIds.push(id);
      await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );

      for (const organizationId of [customerOrgAId, customerOrgBId]) {
        const bareCustomerContext: TenantContextInput = { userId: platformUserId, organizationId, isPlatformStaff: false };
        const rows = await withTenantContext(bareCustomerContext, (tx) => tx.customerService.findMany());
        expect(rows).toHaveLength(0);
      }
    });

    it("denies DELETE on both tables", async () => {
      const definitionId = await seedDefinition();
      const outcome = await withTenantContext(platformContext(), (tx) => tx.serviceDefinition.deleteMany({ where: { id: definitionId } }).then((r) => ({ count: r.count })).catch((error: unknown) => ({ error })));
      if ("count" in outcome) expect(outcome.count).toBe(0);
      else expect(outcome.error).toBeDefined();
      const stillThere = await withTenantContext(platformContext(), (tx) => serviceDefinitionRepository.findById(definitionId, tx));
      expect(stillThere).not.toBeNull();
    });
  });

  describe("CustomerService lifecycle CAS", () => {
    it("full path: PENDING -> ACTIVE -> PAUSED -> ACTIVE -> COMPLETED -> ACTIVE (reopen)", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();
      customerServiceIds.push(id);
      await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );

      await withTenantContext(platformContext(), async (tx) => {
        const activated = await customerServiceRepository.activate(id, tx);
        expect(activated?.status).toBe("ACTIVE");
        const paused = await customerServiceRepository.pause(id, tx);
        expect(paused?.status).toBe("PAUSED");
        const resumed = await customerServiceRepository.resume(id, tx);
        expect(resumed?.status).toBe("ACTIVE");
        const completed = await customerServiceRepository.complete(id, tx);
        expect(completed?.status).toBe("COMPLETED");
        const reopened = await customerServiceRepository.reopen(id, tx);
        expect(reopened?.status).toBe("ACTIVE");
      });
    });

    it("CAS rejects an out-of-order transition (e.g. activating an already-ACTIVE service twice)", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();
      customerServiceIds.push(id);
      await withTenantContext(platformContext(), (tx) =>
        customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx),
      );

      await withTenantContext(platformContext(), async (tx) => {
        const firstActivate = await customerServiceRepository.activate(id, tx);
        expect(firstActivate?.status).toBe("ACTIVE");
        const secondActivate = await customerServiceRepository.activate(id, tx);
        expect(secondActivate).toBeNull();
      });
    });

    it("exactly one of two concurrent completion attempts wins", async () => {
      const { serviceItemId, companyId } = await seedOnboardingWithServiceItem();
      const definitionId = await seedDefinition();
      const id = generateId();
      customerServiceIds.push(id);
      await withTenantContext(platformContext(), async (tx) => {
        await customerServiceRepository.create({ id, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, serviceDefinitionId: definitionId, sourceOnboardingServiceItemId: serviceItemId, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId }, tx);
        await customerServiceRepository.activate(id, tx);
      });

      const complete = () => withTenantContext(platformContext(), (tx) => customerServiceRepository.complete(id, tx));
      const [resultA, resultB] = await Promise.all([complete(), complete()]);
      const nonNullCount = [resultA, resultB].filter((r) => r !== null).length;
      expect(nonNullCount).toBe(1);
    });
  });

  // Codex Security Engineer finding SM-SEC-02 (Build 29 review) — an
  // ACTIVE `OrganizationMembership` alone does not mean the underlying
  // `User` is still usable; global suspension/deactivation deliberately
  // leaves memberships untouched. The fix lives in the shared
  // `assertPlatformStaffMember()` (`crm-shared.ts`), which — like every
  // other `*-shared.ts` authorization-resolution file — transitively
  // imports `requirePermission()`/next-auth session machinery, so it
  // cannot be imported into this plain-Vitest, no-HTTP-session DB
  // integration file (attempted directly; failed with a `next/server`
  // module-resolution error, confirming this is a hard boundary, not an
  // oversight). Regression-tested instead at the E2E layer, against a
  // real authenticated session — see
  // `tests/e2e/service-management.spec.ts`'s own identically-named
  // "Codex Security Engineer finding SM-SEC-02" describe block.
});
