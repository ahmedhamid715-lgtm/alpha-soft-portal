import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput, type TenantTransactionClient } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { websiteDeploymentRepository } from "@/server/repositories/website-deployment-repository";
import { websiteEngagementRepository } from "@/server/repositories/website-engagement-repository";
import { websiteEnvironmentRepository } from "@/server/repositories/website-environment-repository";
import { websitePageRepository } from "@/server/repositories/website-page-repository";
import { websiteSiteRepository } from "@/server/repositories/website-site-repository";

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

const WEBSITE_TABLES = ["website_engagements", "website_sites", "website_environments", "website_pages", "website_deployments"] as const;

type WebsiteGraph = {
  engagementId: string;
  siteId: string;
  environmentId: string;
  pageId: string;
  deploymentId: string;
};

function errorDiagnostic(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();

  function visit(value: unknown, depth: number): void {
    if (value == null || depth > 8) return;
    if (typeof value !== "object") {
      parts.push(String(value));
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof Error) parts.push(value.name, value.message);
    for (const [key, child] of Object.entries(value)) {
      parts.push(key);
      visit(child, depth + 1);
    }
    if (value instanceof Error) visit(value.cause, depth + 1);
  }

  visit(error, 0);
  return parts.join(" ");
}

async function expectPgError(promise: Promise<unknown>, sqlStateOrPrismaCode?: string, messageFragment?: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the restricted database operation to be rejected").toBeDefined();
  const diagnostic = errorDiagnostic(caught);
  if (sqlStateOrPrismaCode) expect(diagnostic).toContain(sqlStateOrPrismaCode);
  if (messageFragment) expect(diagnostic.toLowerCase()).toContain(messageFragment.toLowerCase());
}

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Website Development database security (Build 32)", () => {
  let organizationAId: string;
  let organizationBId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;
  let companyAId: string;
  let companyBId: string;
  let webDefinitionAId: string;
  let webDefinitionBId: string;
  let seoDefinitionId: string;
  let localSeoDefinitionId: string;
  let webCustomerServiceAId: string;
  let webCustomerServiceBId: string;
  let seoCustomerServiceId: string;
  let localSeoCustomerServiceId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const definitionIds: string[] = [];
  const customerServiceIds: string[] = [];
  const engagementIds: string[] = [];
  const siteIds: string[] = [];
  const environmentIds: string[] = [];
  const pageIds: string[] = [];
  const deploymentIds: string[] = [];

  const platformContext = (organizationId = organizationAId): TenantContextInput => ({ userId: platformUserId, organizationId, isPlatformStaff: true });

  beforeEach(async () => {
    organizationAId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!organizationAId) {
      organizationAId = generateId();
      organizationIds.push(organizationAId);
      await db.organization.create({ data: { id: organizationAId, name: "Platform", displayName: "Platform", slug: `website-dev-platform-${organizationAId}`, isPlatform: true } });
    }

    organizationBId = await createOrganization("Website Dev Owner B");
    customerOrgAId = await createOrganization("Website Dev Customer A");
    customerOrgBId = await createOrganization("Website Dev Customer B");
    platformUserId = generateId();
    userIds.push(platformUserId);
    await userRepository.create({ id: platformUserId, email: `website-dev-rls-${platformUserId}@example.com`, name: `Website Dev RLS Actor ${platformUserId}` });

    companyAId = generateId();
    companyBId = generateId();
    companyIds.push(companyAId, companyBId);
    webDefinitionAId = generateId();
    webDefinitionBId = generateId();
    seoDefinitionId = generateId();
    localSeoDefinitionId = generateId();
    definitionIds.push(webDefinitionAId, webDefinitionBId, seoDefinitionId, localSeoDefinitionId);
    webCustomerServiceAId = generateId();
    webCustomerServiceBId = generateId();
    seoCustomerServiceId = generateId();
    localSeoCustomerServiceId = generateId();
    customerServiceIds.push(webCustomerServiceAId, webCustomerServiceBId, seoCustomerServiceId, localSeoCustomerServiceId);

    await withTenantContext(platformContext(organizationAId), async (tx) => {
      await crmCompanyRepository.create({ id: companyAId, organizationId: organizationAId, name: `Website Dev Company A ${companyAId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyAId, customerOrgAId, tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(webDefinitionAId, organizationAId, "WEB_DEVELOPMENT", "ONE_TIME", 0), tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(seoDefinitionId, organizationAId, "SEO", "RECURRING", 1), tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(localSeoDefinitionId, organizationAId, "LOCAL_SEO", "RECURRING", 2), tx);
      await customerServiceRepository.create(customerServiceInput(webCustomerServiceAId, organizationAId, customerOrgAId, companyAId, webDefinitionAId), tx);
      await customerServiceRepository.create(customerServiceInput(seoCustomerServiceId, organizationAId, customerOrgAId, companyAId, seoDefinitionId), tx);
      await customerServiceRepository.create(customerServiceInput(localSeoCustomerServiceId, organizationAId, customerOrgAId, companyAId, localSeoDefinitionId), tx);
    });

    await withTenantContext(platformContext(organizationBId), async (tx) => {
      await crmCompanyRepository.create({ id: companyBId, organizationId: organizationBId, name: `Website Dev Company B ${companyBId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyBId, customerOrgBId, tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(webDefinitionBId, organizationBId, "WEB_DEVELOPMENT", "ONE_TIME", 0), tx);
      await customerServiceRepository.create(customerServiceInput(webCustomerServiceBId, organizationBId, customerOrgBId, companyBId, webDefinitionBId), tx);
    });
  });

  afterEach(async () => {
    if (deploymentIds.length) await db.websiteDeployment.deleteMany({ where: { id: { in: deploymentIds } } });
    if (pageIds.length) await db.websitePage.deleteMany({ where: { id: { in: pageIds } } });
    if (environmentIds.length) await db.websiteEnvironment.deleteMany({ where: { id: { in: environmentIds } } });
    if (siteIds.length) await db.websiteSite.deleteMany({ where: { id: { in: siteIds } } });
    if (engagementIds.length) await db.websiteEngagement.deleteMany({ where: { id: { in: engagementIds } } });
    if (customerServiceIds.length) await db.customerService.deleteMany({ where: { id: { in: customerServiceIds } } });
    if (definitionIds.length) await db.serviceDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    for (const ids of [deploymentIds, pageIds, environmentIds, siteIds, engagementIds, customerServiceIds, definitionIds, companyIds, userIds, organizationIds]) ids.length = 0;
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `website-dev-rls-${id}` });
    return id;
  }

  function serviceDefinitionInput(id: string, organizationId: string, category: "WEB_DEVELOPMENT" | "SEO" | "LOCAL_SEO", deliveryCadence: "ONE_TIME" | "RECURRING", sortOrder: number) {
    return { id, organizationId, name: `${category} ${id}`, code: `${category}-${id}`, description: null, category, deliveryCadence, sortOrder };
  }

  function customerServiceInput(id: string, organizationId: string, customerOrganizationId: string, companyId: string, serviceDefinitionId: string) {
    return { id, organizationId, customerOrganizationId, companyId, serviceDefinitionId, sourceOnboardingServiceItemId: null, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId };
  }

  async function createEngagement(customerServiceId = webCustomerServiceAId, organizationId = organizationAId): Promise<string> {
    const id = generateId();
    engagementIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => websiteEngagementRepository.create({ id, organizationId, customerServiceId, createdByUserId: platformUserId }, tx));
    return id;
  }

  function siteInput(id: string, engagementId: string, organizationId: string, normalizedPrimaryOrigin: string | null = `https://${id}.example.test`) {
    return {
      id,
      organizationId,
      engagementId,
      name: `Website ${id}`,
      primaryUrl: normalizedPrimaryOrigin,
      normalizedPrimaryOrigin,
      siteType: "STANDARD" as const,
      platform: "CUSTOM_NEXTJS" as const,
      technologyNotes: null,
      repositoryUrl: null,
      analyticsConfigured: "UNKNOWN" as const,
      tagManagerConfigured: "UNKNOWN" as const,
      createdByUserId: platformUserId,
    };
  }

  async function createSite(engagementId: string, organizationId = organizationAId, normalizedPrimaryOrigin: string | null = `https://${generateId()}.example.test`): Promise<string> {
    const id = generateId();
    siteIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => websiteSiteRepository.create(siteInput(id, engagementId, organizationId, normalizedPrimaryOrigin), tx));
    return id;
  }

  async function createEnvironment(siteId: string, organizationId = organizationAId, type: "LOCAL" | "DEVELOPMENT" | "STAGING" | "PRODUCTION" = "STAGING"): Promise<string> {
    const id = generateId();
    environmentIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) =>
      websiteEnvironmentRepository.upsertForType(id, siteId, organizationId, type, platformUserId, { url: null, normalizedOrigin: null, status: "ACTIVE", providerLabel: "Fixture", customerVisible: false }, tx),
    );
    return id;
  }

  async function createPage(siteId: string, organizationId = organizationAId, path = `/${generateId()}`): Promise<string> {
    const id = generateId();
    pageIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => websitePageRepository.create({ id, organizationId, siteId, title: `Page ${id}`, path, pageType: "PAGE", required: true, sortOrder: 0, projectTaskId: null, createdByUserId: platformUserId }, tx));
    return id;
  }

  async function createDeployment(siteId: string, environmentId: string, organizationId = organizationAId, overrides: Partial<{ id: string; rollbackOfDeploymentId: string | null }> = {}): Promise<string> {
    const id = overrides.id ?? generateId();
    deploymentIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) =>
      websiteDeploymentRepository.create({ id, organizationId, siteId, environmentId, deployedAt: new Date("2026-09-15T12:00:00.000Z"), status: "SUCCEEDED", versionLabel: "fixture", notes: null, rollbackOfDeploymentId: overrides.rollbackOfDeploymentId ?? null, createdByUserId: platformUserId }, tx),
    );
    return id;
  }

  async function seedFullGraph(): Promise<WebsiteGraph> {
    const engagementId = await createEngagement();
    const siteId = await createSite(engagementId);
    const environmentId = await createEnvironment(siteId);
    const pageId = await createPage(siteId);
    const deploymentId = await createDeployment(siteId, environmentId);
    return { engagementId, siteId, environmentId, pageId, deploymentId };
  }

  async function countsForAllTables(context: TenantContextInput): Promise<Record<(typeof WEBSITE_TABLES)[number], number>> {
    return withTenantContext(context, async (tx) => ({
      website_engagements: await tx.websiteEngagement.count(),
      website_sites: await tx.websiteSite.count(),
      website_environments: await tx.websiteEnvironment.count(),
      website_pages: await tx.websitePage.count(),
      website_deployments: await tx.websiteDeployment.count(),
    }));
  }

  describe("RLS and grants", () => {
    it("uses the genuinely restricted alpha_os_app role", async () => {
      const [role] = await withTenantContext(platformContext(), (tx) => tx.$queryRaw<Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>>`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(role).toEqual({ current_user: "alpha_os_app", rolsuper: false, rolbypassrls: false });
    });

    it("fails closed with no tenant context on all five Website Development tables", async () => {
      await seedFullGraph();
      expect(await countsForAllTables(NO_TENANT_CONTEXT)).toEqual(Object.fromEntries(WEBSITE_TABLES.map((table) => [table, 0])));
    });

    it("hides all five tables from either bare customer-organization context", async () => {
      await seedFullGraph();
      for (const organizationId of [customerOrgAId, customerOrgBId]) {
        expect(await countsForAllTables({ userId: platformUserId, organizationId, isPlatformStaff: false })).toEqual(Object.fromEntries(WEBSITE_TABLES.map((table) => [table, 0])));
      }
    });

    it("rejects raw DELETE statements against all five tables", async () => {
      const graph = await seedFullGraph();
      const ids: Record<(typeof WEBSITE_TABLES)[number], string> = {
        website_engagements: graph.engagementId,
        website_sites: graph.siteId,
        website_environments: graph.environmentId,
        website_pages: graph.pageId,
        website_deployments: graph.deploymentId,
      };
      for (const table of WEBSITE_TABLES) {
        await expectPgError(withTenantContext(platformContext(), (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = $1::uuid`, ids[table])), "42501", `permission denied for table ${table}`);
      }
    });

    it("keeps deployments append-only while engagements, sites, environments, and pages remain mutable", async () => {
      const graph = await seedFullGraph();
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.$executeRaw`UPDATE website_deployments SET notes = 'tampered' WHERE id = ${graph.deploymentId}::uuid`), "42501", "permission denied for table website_deployments");

      await withTenantContext(platformContext(), async (tx) => {
        expect(await tx.$executeRaw`UPDATE website_engagements SET updated_at = NOW() WHERE id = ${graph.engagementId}::uuid`).toBe(1);
        expect((await websiteSiteRepository.update(graph.siteId, { name: "Updated site" }, tx)).name).toBe("Updated site");
        expect((await tx.websiteEnvironment.update({ where: { id: graph.environmentId }, data: { providerLabel: "Updated provider" } })).providerLabel).toBe("Updated provider");
        expect((await websitePageRepository.update(graph.pageId, { title: "Updated page" }, tx)).title).toBe("Updated page");
      });
    });
  });

  describe("category relationship integrity", () => {
    it("accepts WEB_DEVELOPMENT and rejects both SEO and LOCAL_SEO CustomerServices with SQLSTATE 23514", async () => {
      const acceptedId = await createEngagement();
      expect((await withTenantContext(platformContext(), (tx) => websiteEngagementRepository.findById(acceptedId, tx)))?.customerServiceId).toBe(webCustomerServiceAId);

      for (const customerServiceId of [seoCustomerServiceId, localSeoCustomerServiceId]) {
        const id = generateId();
        engagementIds.push(id);
        await expectPgError(withTenantContext(platformContext(), (tx) => websiteEngagementRepository.create({ id, organizationId: organizationAId, customerServiceId, createdByUserId: platformUserId }, tx)), "23514", "must use a service definition with category WEB_DEVELOPMENT");
      }
    });

    it("uses a genuinely separate trigger function from both specialist SEO domains", async () => {
      const functions = await withTenantContext(platformContext(), (tx) =>
        tx.$queryRaw<Array<{ oid: string; proname: string; definition: string }>>`
          SELECT p.oid::text AS oid, p.proname, pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = current_schema()
            AND p.proname IN (
              'website_engagements_enforce_relationship_integrity',
              'seo_engagements_enforce_relationship_integrity',
              'local_seo_engagements_enforce_relationship_integrity'
            )
          ORDER BY p.proname
        `,
      );
      expect(functions.map((fn) => fn.proname).sort()).toEqual([
        "local_seo_engagements_enforce_relationship_integrity",
        "seo_engagements_enforce_relationship_integrity",
        "website_engagements_enforce_relationship_integrity",
      ]);
      expect(new Set(functions.map((fn) => fn.oid)).size).toBe(3);
      expect(functions.find((fn) => fn.proname.startsWith("website_"))?.definition).toContain("'WEB_DEVELOPMENT'::service_category");
      expect(functions.find((fn) => fn.proname.startsWith("seo_"))?.definition).toContain("'SEO'::service_category");
      expect(functions.find((fn) => fn.proname.startsWith("local_seo_"))?.definition).toContain("'LOCAL_SEO'::service_category");
      expect(new Set(functions.map((fn) => fn.definition)).size).toBe(3);
    });
  });

  describe("organization-integrity triggers", () => {
    it("rejects forged organization IDs for every child table with SQLSTATE 23514", async () => {
      const engagementAId = await createEngagement();
      const engagementBId = await createEngagement(webCustomerServiceBId, organizationBId);
      const siteAId = await createSite(engagementAId);
      const siteBId = await createSite(engagementBId, organizationBId);
      const environmentAId = await createEnvironment(siteAId);
      const environmentBId = await createEnvironment(siteBId, organizationBId);

      const attempts: Array<[string, (tx: TenantTransactionClient) => Promise<unknown>, string]> = [
        ["website_sites", (tx) => tx.websiteSite.create({ data: siteInput(generateId(), engagementAId, organizationBId) }), "Website site organization must match its engagement organization"],
        ["website_environments", (tx) => tx.websiteEnvironment.create({ data: { id: generateId(), organizationId: organizationBId, siteId: siteAId, type: "PRODUCTION", createdByUserId: platformUserId } }), "Website environment organization must match its site organization"],
        ["website_pages", (tx) => tx.websitePage.create({ data: { id: generateId(), organizationId: organizationBId, siteId: siteAId, title: "Forged page", path: "/forged", createdByUserId: platformUserId } }), "Website page organization must match its site organization"],
        ["website_deployments/site", (tx) => tx.websiteDeployment.create({ data: { id: generateId(), organizationId: organizationBId, siteId: siteAId, environmentId: environmentBId, deployedAt: new Date(), status: "FAILED", createdByUserId: platformUserId } }), "Website deployment organization must match its site organization"],
        ["website_deployments/environment", (tx) => tx.websiteDeployment.create({ data: { id: generateId(), organizationId: organizationAId, siteId: siteAId, environmentId: environmentBId, deployedAt: new Date(), status: "FAILED", createdByUserId: platformUserId } }), "Website deployment organization must match its environment organization"],
      ];

      for (const [label, attempt, message] of attempts) {
        await expectPgError(withTenantContext(platformContext(), attempt), "23514", message);
        expect(label).toBeTruthy();
      }
      expect(environmentAId).not.toBe(environmentBId);
    });
  });

  describe("idempotency and uniqueness", () => {
    it("rejects a second engagement for the same CustomerService", async () => {
      await createEngagement();
      const id = generateId();
      engagementIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => websiteEngagementRepository.create({ id, organizationId: organizationAId, customerServiceId: webCustomerServiceAId, createdByUserId: platformUserId }, tx)), "P2002");
    });

    it("deduplicates known site origins but permits multiple NULL origins", async () => {
      const engagementId = await createEngagement();
      const origin = `https://duplicate-${generateId()}.example.test`;
      await createSite(engagementId, organizationAId, origin);
      const duplicateId = generateId();
      siteIds.push(duplicateId);
      await expectPgError(withTenantContext(platformContext(), (tx) => websiteSiteRepository.create(siteInput(duplicateId, engagementId, organizationAId, origin), tx)), "P2002");

      const nullSiteAId = await createSite(engagementId, organizationAId, null);
      const nullSiteBId = await createSite(engagementId, organizationAId, null);
      expect(await withTenantContext(platformContext(), (tx) => tx.websiteSite.count({ where: { id: { in: [nullSiteAId, nullSiteBId] }, normalizedPrimaryOrigin: null } }))).toBe(2);
    });

    it("enforces one environment per (siteId, type), which upsertForType uses as its conflict target", async () => {
      const siteId = await createSite(await createEngagement());
      const firstId = await createEnvironment(siteId, organizationAId, "PRODUCTION");
      const duplicateId = generateId();
      environmentIds.push(duplicateId);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.websiteEnvironment.create({ data: { id: duplicateId, organizationId: organizationAId, siteId, type: "PRODUCTION", createdByUserId: platformUserId } })), "P2002");

      const upserted = await withTenantContext(platformContext(), (tx) => websiteEnvironmentRepository.upsertForType(generateId(), siteId, organizationAId, "PRODUCTION", platformUserId, { url: "https://production.example.test", normalizedOrigin: "https://production.example.test", status: "ACTIVE", providerLabel: "Upserted", customerVisible: true }, tx));
      expect(upserted.id).toBe(firstId);
      expect(upserted.providerLabel).toBe("Upserted");
      expect(await withTenantContext(platformContext(), (tx) => tx.websiteEnvironment.count({ where: { siteId, type: "PRODUCTION" } }))).toBe(1);
    });

    it("rejects a second page for the same (siteId, path)", async () => {
      const siteId = await createSite(await createEngagement());
      const path = `/duplicate-${generateId()}`;
      await createPage(siteId, organizationAId, path);
      const id = generateId();
      pageIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => websitePageRepository.create({ id, organizationId: organizationAId, siteId, title: "Duplicate", path, pageType: "PAGE", required: true, sortOrder: 1, projectTaskId: null, createdByUserId: platformUserId }, tx)), "P2002");
    });

    it("allows exactly one winner in a real concurrent engagement race", async () => {
      const idA = generateId();
      const idB = generateId();
      engagementIds.push(idA, idB);
      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) => websiteEngagementRepository.create({ id, organizationId: organizationAId, customerServiceId: webCustomerServiceAId, createdByUserId: platformUserId }, tx))
          .then(() => "fulfilled" as const)
          .catch((error: unknown) => ({ status: "rejected" as const, diagnostic: errorDiagnostic(error) }));
      const results = await Promise.all([attempt(idA), attempt(idB)]);
      expect(results.filter((result) => result === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result !== "fulfilled");
      expect(rejected).toBeDefined();
      if (rejected !== undefined) expect(rejected.diagnostic).toContain("P2002");
    });

    it("allows exactly one winner in a real concurrent normalized-origin site race", async () => {
      const engagementId = await createEngagement();
      const origin = `https://race-${generateId()}.example.test`;
      const idA = generateId();
      const idB = generateId();
      siteIds.push(idA, idB);
      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) => websiteSiteRepository.create(siteInput(id, engagementId, organizationAId, origin), tx))
          .then(() => "fulfilled" as const)
          .catch((error: unknown) => ({ status: "rejected" as const, diagnostic: errorDiagnostic(error) }));
      const results = await Promise.all([attempt(idA), attempt(idB)]);
      expect(results.filter((result) => result === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result !== "fulfilled");
      expect(rejected).toBeDefined();
      if (rejected !== undefined) expect(rejected.diagnostic).toContain("P2002");
    });
  });

  describe("CHECK constraints", () => {
    it("rejects an all-whitespace site name", async () => {
      const engagementId = await createEngagement();
      const id = generateId();
      siteIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => websiteSiteRepository.create({ ...siteInput(id, engagementId, organizationAId), name: "   " }, tx)), "23514", "website_sites_name_non_blank_check");
    });

    it("rejects an all-whitespace page title", async () => {
      const siteId = await createSite(await createEngagement());
      const id = generateId();
      pageIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => websitePageRepository.create({ id, organizationId: organizationAId, siteId, title: "   ", path: "/blank-title", pageType: "PAGE", required: true, sortOrder: 0, projectTaskId: null, createdByUserId: platformUserId }, tx)), "23514", "website_pages_title_non_blank_check");
    });

    it.each(["relative/path", "", "   "])("rejects an invalid page path %j", async (path) => {
      const siteId = await createSite(await createEngagement());
      const id = generateId();
      pageIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => websitePageRepository.create({ id, organizationId: organizationAId, siteId, title: "Invalid path", path, pageType: "PAGE", required: true, sortOrder: 0, projectTaskId: null, createdByUserId: platformUserId }, tx)), "23514", "website_pages_path_check");
    });

    it("rejects a deployment that rolls back itself", async () => {
      const siteId = await createSite(await createEngagement());
      const environmentId = await createEnvironment(siteId);
      const id = generateId();
      deploymentIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => websiteDeploymentRepository.create({ id, organizationId: organizationAId, siteId, environmentId, deployedAt: new Date(), status: "ROLLED_BACK", versionLabel: null, notes: null, rollbackOfDeploymentId: id, createdByUserId: platformUserId }, tx)), "23514", "website_deployments_rollback_not_self_check");
    });
  });

  describe("defense-in-depth for forged relationships", () => {
    it("proves the child-table WITH CHECK policies are forced and independently require platform tenant ownership", async () => {
      const policies = await withTenantContext(platformContext(), (tx) =>
        tx.$queryRaw<Array<{ table_name: string; row_security: boolean; force_row_security: boolean; with_check: string }>>`
          SELECT c.relname AS table_name,
                 c.relrowsecurity AS row_security,
                 c.relforcerowsecurity AS force_row_security,
                 pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND p.polname = 'tenant_isolation_insert'
            AND c.relname IN ('website_environments', 'website_pages', 'website_deployments')
          ORDER BY c.relname
        `,
      );
      expect(policies.map((policy) => policy.table_name)).toEqual(["website_deployments", "website_environments", "website_pages"]);
      for (const policy of policies) {
        expect(policy.row_security).toBe(true);
        expect(policy.force_row_security).toBe(true);
        expect(policy.with_check).toContain("organization_id = tenant_current_organization_id()");
        expect(policy.with_check).toContain("tenant_is_platform_context()");
      }
    });

    it("operationally rejects forged environment, page, and deployment parent relationships in their BEFORE triggers", async () => {
      const engagementAId = await createEngagement();
      const engagementBId = await createEngagement(webCustomerServiceBId, organizationBId);
      const siteAId = await createSite(engagementAId);
      const siteBId = await createSite(engagementBId, organizationBId);
      const environmentBId = await createEnvironment(siteBId, organizationBId);

      await expectPgError(withTenantContext(platformContext(), (tx) => tx.websiteEnvironment.create({ data: { id: generateId(), organizationId: organizationBId, siteId: siteAId, type: "LOCAL", createdByUserId: platformUserId } })), "23514", "Website environment organization must match its site organization");
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.websitePage.create({ data: { id: generateId(), organizationId: organizationBId, siteId: siteAId, title: "Forged", path: "/forged-defense", createdByUserId: platformUserId } })), "23514", "Website page organization must match its site organization");
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.websiteDeployment.create({ data: { id: generateId(), organizationId: organizationAId, siteId: siteAId, environmentId: environmentBId, deployedAt: new Date(), status: "FAILED", createdByUserId: platformUserId } })), "23514", "Website deployment organization must match its environment organization");
    });
  });
});
