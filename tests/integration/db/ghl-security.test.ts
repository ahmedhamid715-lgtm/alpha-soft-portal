import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import {
  withTenantContext,
  type TenantContextInput,
  type TenantTransactionClient,
} from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { ghlAssetRepository } from "@/server/repositories/ghl-asset-repository";
import { ghlEngagementRepository } from "@/server/repositories/ghl-engagement-repository";
import { ghlImportBatchRepository } from "@/server/repositories/ghl-import-batch-repository";
import { ghlIntegrationRequirementRepository } from "@/server/repositories/ghl-integration-requirement-repository";
import { ghlWorkspaceRepository } from "@/server/repositories/ghl-workspace-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { userRepository } from "@/server/repositories/user-repository";

const NO_TENANT_CONTEXT: TenantContextInput = {
  userId: null,
  organizationId: null,
  isPlatformStaff: false,
};

const GHL_TABLES = [
  "ghl_automation_engagements",
  "ghl_workspaces",
  "ghl_assets",
  "ghl_integration_requirements",
  "ghl_import_batches",
] as const;

type GhlGraph = {
  engagementId: string;
  workspaceId: string;
  assetId: string;
  integrationRequirementId: string;
  importBatchId: string;
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

async function expectPgError(
  promise: Promise<unknown>,
  sqlStateOrPrismaCode?: string,
  messageFragment?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(
    caught,
    "expected the restricted database operation to be rejected",
  ).toBeDefined();
  const diagnostic = errorDiagnostic(caught);
  if (sqlStateOrPrismaCode) expect(diagnostic).toContain(sqlStateOrPrismaCode);
  if (messageFragment)
    expect(diagnostic.toLowerCase()).toContain(messageFragment.toLowerCase());
}

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)(
  "GHL Automation OS database security (Build 34)",
  () => {
    let organizationAId: string;
    let organizationBId: string;
    let customerOrgAId: string;
    let customerOrgBId: string;
    let platformUserId: string;
    let companyAId: string;
    let companyBId: string;
    let ghlDefinitionAId: string;
    let ecommerceDefinitionId: string;
    let webDefinitionId: string;
    let ghlDefinitionBId: string;
    let ghlCustomerServiceAId: string;
    let ecommerceCustomerServiceId: string;
    let webCustomerServiceId: string;
    let ghlCustomerServiceBId: string;

    const organizationIds: string[] = [];
    const userIds: string[] = [];
    const companyIds: string[] = [];
    const definitionIds: string[] = [];
    const customerServiceIds: string[] = [];
    const engagementIds: string[] = [];
    const workspaceIds: string[] = [];
    const assetIds: string[] = [];
    const integrationRequirementIds: string[] = [];
    const importBatchIds: string[] = [];

    const platformContext = (
      organizationId = organizationAId,
    ): TenantContextInput => ({
      userId: platformUserId,
      organizationId,
      isPlatformStaff: true,
    });

    beforeEach(async () => {
      organizationAId =
        (await organizationRepository.findPlatformOrganization())?.id ?? "";
      if (!organizationAId) {
        organizationAId = generateId();
        organizationIds.push(organizationAId);
        await db.organization.create({
          data: {
            id: organizationAId,
            name: "Platform",
            displayName: "Platform",
            slug: `ghl-platform-${organizationAId}`,
            isPlatform: true,
          },
        });
      }

      organizationBId = await createOrganization("GHL Owner B");
      customerOrgAId = await createOrganization("GHL Customer A");
      customerOrgBId = await createOrganization("GHL Customer B");
      platformUserId = generateId();
      userIds.push(platformUserId);
      await userRepository.create({
        id: platformUserId,
        email: `ghl-rls-${platformUserId}@example.com`,
        name: `GHL RLS Actor ${platformUserId}`,
      });

      companyAId = generateId();
      companyBId = generateId();
      companyIds.push(companyAId, companyBId);
      ghlDefinitionAId = generateId();
      ecommerceDefinitionId = generateId();
      webDefinitionId = generateId();
      ghlDefinitionBId = generateId();
      definitionIds.push(
        ghlDefinitionAId,
        ecommerceDefinitionId,
        webDefinitionId,
        ghlDefinitionBId,
      );
      ghlCustomerServiceAId = generateId();
      ecommerceCustomerServiceId = generateId();
      webCustomerServiceId = generateId();
      ghlCustomerServiceBId = generateId();
      customerServiceIds.push(
        ghlCustomerServiceAId,
        ecommerceCustomerServiceId,
        webCustomerServiceId,
        ghlCustomerServiceBId,
      );

      await withTenantContext(platformContext(organizationAId), async (tx) => {
        await crmCompanyRepository.create(
          {
            id: companyAId,
            organizationId: organizationAId,
            name: `GHL Company A ${companyAId}`,
            domain: null,
            industry: null,
            website: null,
            phone: null,
          },
          tx,
        );
        await crmCompanyRepository.linkToOrganization(
          companyAId,
          customerOrgAId,
          tx,
        );
        await serviceDefinitionRepository.create(
          serviceDefinitionInput(
            ghlDefinitionAId,
            organizationAId,
            "GHL_AUTOMATION",
            0,
          ),
          tx,
        );
        await serviceDefinitionRepository.create(
          serviceDefinitionInput(
            ecommerceDefinitionId,
            organizationAId,
            "ECOMMERCE",
            1,
          ),
          tx,
        );
        await serviceDefinitionRepository.create(
          serviceDefinitionInput(
            webDefinitionId,
            organizationAId,
            "WEB_DEVELOPMENT",
            2,
          ),
          tx,
        );
        await customerServiceRepository.create(
          customerServiceInput(
            ghlCustomerServiceAId,
            organizationAId,
            customerOrgAId,
            companyAId,
            ghlDefinitionAId,
          ),
          tx,
        );
        await customerServiceRepository.create(
          customerServiceInput(
            ecommerceCustomerServiceId,
            organizationAId,
            customerOrgAId,
            companyAId,
            ecommerceDefinitionId,
          ),
          tx,
        );
        await customerServiceRepository.create(
          customerServiceInput(
            webCustomerServiceId,
            organizationAId,
            customerOrgAId,
            companyAId,
            webDefinitionId,
          ),
          tx,
        );
      });

      await withTenantContext(platformContext(organizationBId), async (tx) => {
        await crmCompanyRepository.create(
          {
            id: companyBId,
            organizationId: organizationBId,
            name: `GHL Company B ${companyBId}`,
            domain: null,
            industry: null,
            website: null,
            phone: null,
          },
          tx,
        );
        await crmCompanyRepository.linkToOrganization(
          companyBId,
          customerOrgBId,
          tx,
        );
        await serviceDefinitionRepository.create(
          serviceDefinitionInput(
            ghlDefinitionBId,
            organizationBId,
            "GHL_AUTOMATION",
            0,
          ),
          tx,
        );
        await customerServiceRepository.create(
          customerServiceInput(
            ghlCustomerServiceBId,
            organizationBId,
            customerOrgBId,
            companyBId,
            ghlDefinitionBId,
          ),
          tx,
        );
      });
    });

    afterEach(async () => {
      if (assetIds.length)
        await db.ghlAsset.deleteMany({ where: { id: { in: assetIds } } });
      if (integrationRequirementIds.length)
        await db.ghlIntegrationRequirement.deleteMany({
          where: { id: { in: integrationRequirementIds } },
        });
      if (importBatchIds.length)
        await db.ghlImportBatch.deleteMany({
          where: { id: { in: importBatchIds } },
        });
      if (workspaceIds.length)
        await db.ghlWorkspace.deleteMany({
          where: { id: { in: workspaceIds } },
        });
      if (engagementIds.length)
        await db.ghlAutomationEngagement.deleteMany({
          where: { id: { in: engagementIds } },
        });
      if (customerServiceIds.length)
        await db.customerService.deleteMany({
          where: { id: { in: customerServiceIds } },
        });
      if (definitionIds.length)
        await db.serviceDefinition.deleteMany({
          where: { id: { in: definitionIds } },
        });
      if (companyIds.length)
        await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
      if (userIds.length)
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (organizationIds.length)
        await db.organization.deleteMany({
          where: { id: { in: organizationIds } },
        });
      for (const ids of [
        assetIds,
        integrationRequirementIds,
        importBatchIds,
        workspaceIds,
        engagementIds,
        customerServiceIds,
        definitionIds,
        companyIds,
        userIds,
        organizationIds,
      ])
        ids.length = 0;
    });

    async function createOrganization(name: string): Promise<string> {
      const id = generateId();
      organizationIds.push(id);
      await organizationRepository.create({
        id,
        name,
        displayName: name,
        slug: `ghl-rls-${id}`,
      });
      return id;
    }

    function serviceDefinitionInput(
      id: string,
      organizationId: string,
      category: "GHL_AUTOMATION" | "ECOMMERCE" | "WEB_DEVELOPMENT",
      sortOrder: number,
    ) {
      return {
        id,
        organizationId,
        name: `${category} ${id}`,
        code: `${category}-${id}`,
        description: null,
        category,
        deliveryCadence: "ONE_TIME" as const,
        sortOrder,
      };
    }

    function customerServiceInput(
      id: string,
      organizationId: string,
      customerOrganizationId: string,
      companyId: string,
      serviceDefinitionId: string,
    ) {
      return {
        id,
        organizationId,
        customerOrganizationId,
        companyId,
        serviceDefinitionId,
        sourceOnboardingServiceItemId: null,
        quantity: 1,
        ownerUserId: null,
        startDate: null,
        targetEndDate: null,
        createdByUserId: platformUserId,
      };
    }

    async function createEngagement(
      customerServiceId = ghlCustomerServiceAId,
      organizationId = organizationAId,
    ): Promise<string> {
      const id = generateId();
      engagementIds.push(id);
      await withTenantContext(platformContext(organizationId), (tx) =>
        ghlEngagementRepository.create(
          {
            id,
            organizationId,
            customerServiceId,
            createdByUserId: platformUserId,
          },
          tx,
        ),
      );
      return id;
    }

    function workspaceInput(
      id: string,
      engagementId: string,
      organizationId = organizationAId,
      overrides: Partial<{
        name: string;
        externalLocationId: string | null;
      }> = {},
    ) {
      return {
        id,
        organizationId,
        engagementId,
        name: overrides.name ?? `Workspace ${id}`,
        externalLocationId: overrides.externalLocationId ?? null,
        locationUrl: null,
        createdByUserId: platformUserId,
      };
    }

    async function createWorkspace(
      engagementId: string,
      organizationId = organizationAId,
      overrides: Partial<{
        name: string;
        externalLocationId: string | null;
      }> = {},
    ): Promise<string> {
      const id = generateId();
      workspaceIds.push(id);
      await withTenantContext(platformContext(organizationId), (tx) =>
        ghlWorkspaceRepository.create(
          workspaceInput(id, engagementId, organizationId, overrides),
          tx,
        ),
      );
      return id;
    }

    function assetInput(
      id: string,
      workspaceId: string,
      organizationId = organizationAId,
      overrides: Partial<{
        name: string;
        externalAssetId: string | null;
        importBatchId: string | null;
      }> = {},
    ) {
      return {
        id,
        organizationId,
        workspaceId,
        assetType: "WORKFLOW" as const,
        name: overrides.name ?? `Asset ${id}`,
        externalAssetId: overrides.externalAssetId ?? null,
        source: overrides.importBatchId
          ? ("IMPORT" as const)
          : ("MANUAL" as const),
        requiredForLaunch: true,
        customerVisible: false,
        sortOrder: 0,
        notes: null,
        importBatchId: overrides.importBatchId ?? null,
        createdByUserId: platformUserId,
      };
    }

    async function createAsset(
      workspaceId: string,
      organizationId = organizationAId,
      overrides: Partial<{
        name: string;
        externalAssetId: string | null;
        importBatchId: string | null;
      }> = {},
    ): Promise<string> {
      const id = generateId();
      assetIds.push(id);
      await withTenantContext(platformContext(organizationId), (tx) =>
        ghlAssetRepository.create(
          assetInput(id, workspaceId, organizationId, overrides),
          tx,
        ),
      );
      return id;
    }

    function integrationRequirementInput(
      id: string,
      workspaceId: string,
      organizationId = organizationAId,
      name = `Integration ${id}`,
    ) {
      return {
        id,
        organizationId,
        workspaceId,
        name,
        required: true,
        externalSystemLabel: null,
        customerVisible: false,
        notes: null,
        createdByUserId: platformUserId,
      };
    }

    async function createIntegrationRequirement(
      workspaceId: string,
      organizationId = organizationAId,
    ): Promise<string> {
      const id = generateId();
      integrationRequirementIds.push(id);
      await withTenantContext(platformContext(organizationId), (tx) =>
        ghlIntegrationRequirementRepository.create(
          integrationRequirementInput(id, workspaceId, organizationId),
          tx,
        ),
      );
      return id;
    }

    function importBatchInput(
      id: string,
      workspaceId: string,
      organizationId = organizationAId,
      overrides: Partial<{
        totalRowCount: number;
        importedRowCount: number;
        skippedRowCount: number;
      }> = {},
    ) {
      return {
        id,
        organizationId,
        workspaceId,
        importedByUserId: platformUserId,
        totalRowCount: overrides.totalRowCount ?? 2,
        importedRowCount: overrides.importedRowCount ?? 1,
        skippedRowCount: overrides.skippedRowCount ?? 1,
      };
    }

    async function createImportBatch(
      workspaceId: string,
      organizationId = organizationAId,
      overrides: Partial<{
        totalRowCount: number;
        importedRowCount: number;
        skippedRowCount: number;
      }> = {},
    ): Promise<string> {
      const id = generateId();
      importBatchIds.push(id);
      await withTenantContext(platformContext(organizationId), (tx) =>
        ghlImportBatchRepository.create(
          importBatchInput(id, workspaceId, organizationId, overrides),
          tx,
        ),
      );
      return id;
    }

    async function seedFullGraph(): Promise<GhlGraph> {
      const engagementId = await createEngagement();
      const workspaceId = await createWorkspace(engagementId);
      const importBatchId = await createImportBatch(workspaceId);
      const assetId = await createAsset(workspaceId, organizationAId, {
        importBatchId,
      });
      const integrationRequirementId =
        await createIntegrationRequirement(workspaceId);
      return {
        engagementId,
        workspaceId,
        assetId,
        integrationRequirementId,
        importBatchId,
      };
    }

    async function countsForAllTables(
      context: TenantContextInput,
    ): Promise<Record<(typeof GHL_TABLES)[number], number>> {
      return withTenantContext(context, async (tx) => ({
        ghl_automation_engagements: await tx.ghlAutomationEngagement.count(),
        ghl_workspaces: await tx.ghlWorkspace.count(),
        ghl_assets: await tx.ghlAsset.count(),
        ghl_integration_requirements:
          await tx.ghlIntegrationRequirement.count(),
        ghl_import_batches: await tx.ghlImportBatch.count(),
      }));
    }

    describe("RLS and grants", () => {
      it("uses the genuinely restricted alpha_os_app role", async () => {
        const [role] = await withTenantContext(
          platformContext(),
          (tx) =>
            tx.$queryRaw<
              Array<{
                current_user: string;
                rolsuper: boolean;
                rolbypassrls: boolean;
              }>
            >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        expect(role).toEqual({
          current_user: "alpha_os_app",
          rolsuper: false,
          rolbypassrls: false,
        });
      });

      it("fails closed with no tenant context on all five GHL tables", async () => {
        await seedFullGraph();
        expect(await countsForAllTables(NO_TENANT_CONTEXT)).toEqual(
          Object.fromEntries(GHL_TABLES.map((table) => [table, 0])),
        );
      });

      it("hides all five tables from either bare customer-organization context", async () => {
        await seedFullGraph();
        for (const organizationId of [customerOrgAId, customerOrgBId]) {
          expect(
            await countsForAllTables({
              userId: platformUserId,
              organizationId,
              isPlatformStaff: false,
            }),
          ).toEqual(Object.fromEntries(GHL_TABLES.map((table) => [table, 0])));
        }
      });

      it("rejects raw DELETE statements against all five tables", async () => {
        const graph = await seedFullGraph();
        const ids: Record<(typeof GHL_TABLES)[number], string> = {
          ghl_automation_engagements: graph.engagementId,
          ghl_workspaces: graph.workspaceId,
          ghl_assets: graph.assetId,
          ghl_integration_requirements: graph.integrationRequirementId,
          ghl_import_batches: graph.importBatchId,
        };
        for (const table of GHL_TABLES) {
          await expectPgError(
            withTenantContext(platformContext(), (tx) =>
              tx.$executeRawUnsafe(
                `DELETE FROM ${table} WHERE id = $1::uuid`,
                ids[table],
              ),
            ),
            "42501",
            `permission denied for table ${table}`,
          );
        }
      });

      it("keeps import batches append-only while the other four tables remain mutable", async () => {
        const graph = await seedFullGraph();
        await expectPgError(
          withTenantContext(
            platformContext(),
            (tx) =>
              tx.$executeRaw`UPDATE ghl_import_batches SET total_row_count = 3 WHERE id = ${graph.importBatchId}::uuid`,
          ),
          "42501",
          "permission denied for table ghl_import_batches",
        );

        await withTenantContext(platformContext(), async (tx) => {
          expect(
            await tx.$executeRaw`UPDATE ghl_automation_engagements SET updated_at = NOW() WHERE id = ${graph.engagementId}::uuid`,
          ).toBe(1);
          expect(
            (
              await ghlWorkspaceRepository.update(
                graph.workspaceId,
                { name: "Updated workspace" },
                tx,
              )
            ).name,
          ).toBe("Updated workspace");
          expect(
            (
              await ghlAssetRepository.update(
                graph.assetId,
                { name: "Updated asset" },
                tx,
              )
            ).name,
          ).toBe("Updated asset");
          expect(
            (
              await ghlIntegrationRequirementRepository.update(
                graph.integrationRequirementId,
                { name: "Updated integration" },
                tx,
              )
            ).name,
          ).toBe("Updated integration");
        });
      });
    });

    describe("category relationship integrity", () => {
      it("accepts GHL_AUTOMATION and rejects both ECOMMERCE and WEB_DEVELOPMENT CustomerServices with SQLSTATE 23514", async () => {
        const acceptedId = await createEngagement();
        expect(
          (
            await withTenantContext(platformContext(), (tx) =>
              ghlEngagementRepository.findById(acceptedId, tx),
            )
          )?.customerServiceId,
        ).toBe(ghlCustomerServiceAId);

        for (const customerServiceId of [
          ecommerceCustomerServiceId,
          webCustomerServiceId,
        ]) {
          const id = generateId();
          engagementIds.push(id);
          await expectPgError(
            withTenantContext(platformContext(), (tx) =>
              ghlEngagementRepository.create(
                {
                  id,
                  organizationId: organizationAId,
                  customerServiceId,
                  createdByUserId: platformUserId,
                },
                tx,
              ),
            ),
            "23514",
            "must use a service definition with category GHL_AUTOMATION",
          );
        }
      });

      it("uses its own trigger function rather than Ecommerce, Website Dev, SEO OS, or Local SEO logic", async () => {
        const functions = await withTenantContext(
          platformContext(),
          (tx) =>
            tx.$queryRaw<
              Array<{ oid: string; proname: string; definition: string }>
            >`
          SELECT p.oid::text AS oid, p.proname, pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = current_schema()
            AND p.proname IN (
              'ghl_automation_engagements_enforce_relationship_integrity',
              'ecommerce_engagements_enforce_relationship_integrity',
              'website_engagements_enforce_relationship_integrity',
              'seo_engagements_enforce_relationship_integrity',
              'local_seo_engagements_enforce_relationship_integrity'
            )
          ORDER BY p.proname
        `,
        );
        expect(functions.map((fn) => fn.proname)).toEqual([
          "ecommerce_engagements_enforce_relationship_integrity",
          "ghl_automation_engagements_enforce_relationship_integrity",
          "local_seo_engagements_enforce_relationship_integrity",
          "seo_engagements_enforce_relationship_integrity",
          "website_engagements_enforce_relationship_integrity",
        ]);
        expect(new Set(functions.map((fn) => fn.oid)).size).toBe(5);
        expect(
          functions.find((fn) => fn.proname.startsWith("ghl_"))?.definition,
        ).toContain("'GHL_AUTOMATION'::service_category");
        expect(
          functions.find((fn) => fn.proname.startsWith("ecommerce_"))
            ?.definition,
        ).toContain("'ECOMMERCE'::service_category");
        expect(
          functions.find((fn) => fn.proname.startsWith("website_"))?.definition,
        ).toContain("'WEB_DEVELOPMENT'::service_category");
        expect(new Set(functions.map((fn) => fn.definition)).size).toBe(5);
      });
    });

    describe("organization-integrity triggers", () => {
      it("rejects forged organization IDs for each child table with SQLSTATE 23514", async () => {
        const engagementAId = await createEngagement();
        const engagementBId = await createEngagement(
          ghlCustomerServiceBId,
          organizationBId,
        );
        const workspaceAId = await createWorkspace(engagementAId);
        const workspaceBId = await createWorkspace(
          engagementBId,
          organizationBId,
        );

        const attempts: Array<
          [(tx: TenantTransactionClient) => Promise<unknown>, string]
        > = [
          [
            (tx) =>
              tx.ghlWorkspace.create({
                data: workspaceInput(
                  generateId(),
                  engagementAId,
                  organizationBId,
                ),
              }),
            "GHL workspace organization must match its engagement organization",
          ],
          [
            (tx) =>
              tx.ghlAsset.create({
                data: assetInput(generateId(), workspaceAId, organizationBId),
              }),
            "GHL asset organization must match its workspace organization",
          ],
          [
            (tx) =>
              tx.ghlIntegrationRequirement.create({
                data: integrationRequirementInput(
                  generateId(),
                  workspaceAId,
                  organizationBId,
                ),
              }),
            "GHL integration requirement organization must match its workspace organization",
          ],
          [
            (tx) =>
              tx.ghlImportBatch.create({
                data: importBatchInput(
                  generateId(),
                  workspaceAId,
                  organizationBId,
                ),
              }),
            "GHL import batch organization must match its workspace organization",
          ],
        ];
        for (const [attempt, message] of attempts)
          await expectPgError(
            withTenantContext(platformContext(organizationBId), attempt),
            "23514",
            message,
          );
        expect(engagementAId).not.toBe(engagementBId);
        expect(workspaceAId).not.toBe(workspaceBId);
      });

      it("rejects an asset linked to a real import batch from another workspace", async () => {
        const engagementId = await createEngagement();
        const workspaceAId = await createWorkspace(engagementId);
        const workspaceBId = await createWorkspace(engagementId);
        const batchBId = await createImportBatch(workspaceBId);
        const id = generateId();
        assetIds.push(id);
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlAssetRepository.create(
              assetInput(id, workspaceAId, organizationAId, {
                importBatchId: batchBId,
              }),
              tx,
            ),
          ),
          "23514",
          "GHL asset import batch must belong to the same workspace",
        );
      });
    });

    describe("idempotency and uniqueness", () => {
      it("rejects a second engagement for the same CustomerService", async () => {
        await createEngagement();
        const id = generateId();
        engagementIds.push(id);
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlEngagementRepository.create(
              {
                id,
                organizationId: organizationAId,
                customerServiceId: ghlCustomerServiceAId,
                createdByUserId: platformUserId,
              },
              tx,
            ),
          ),
          "P2002",
        );
      });

      it("deduplicates known external location IDs but permits multiple NULL identifiers", async () => {
        const engagementId = await createEngagement();
        const externalLocationId = `location-${generateId()}`;
        await createWorkspace(engagementId, organizationAId, {
          externalLocationId,
        });
        const duplicateId = generateId();
        workspaceIds.push(duplicateId);
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlWorkspaceRepository.create(
              workspaceInput(duplicateId, engagementId, organizationAId, {
                externalLocationId,
              }),
              tx,
            ),
          ),
          "P2002",
        );

        const nullAId = await createWorkspace(engagementId);
        const nullBId = await createWorkspace(engagementId);
        expect(
          await withTenantContext(platformContext(), (tx) =>
            tx.ghlWorkspace.count({
              where: {
                id: { in: [nullAId, nullBId] },
                externalLocationId: null,
              },
            }),
          ),
        ).toBe(2);
      });

      it("deduplicates known external asset IDs but permits multiple NULL identifiers", async () => {
        const workspaceId = await createWorkspace(await createEngagement());
        const externalAssetId = `asset-${generateId()}`;
        await createAsset(workspaceId, organizationAId, { externalAssetId });
        const duplicateId = generateId();
        assetIds.push(duplicateId);
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlAssetRepository.create(
              assetInput(duplicateId, workspaceId, organizationAId, {
                externalAssetId,
              }),
              tx,
            ),
          ),
          "P2002",
        );

        const nullAId = await createAsset(workspaceId);
        const nullBId = await createAsset(workspaceId);
        expect(
          await withTenantContext(platformContext(), (tx) =>
            tx.ghlAsset.count({
              where: { id: { in: [nullAId, nullBId] }, externalAssetId: null },
            }),
          ),
        ).toBe(2);
      });

      it("allows exactly one winner in a real concurrent engagement race", async () => {
        const idA = generateId();
        const idB = generateId();
        engagementIds.push(idA, idB);
        const attempt = (id: string) =>
          withTenantContext(platformContext(), (tx) =>
            ghlEngagementRepository.create(
              {
                id,
                organizationId: organizationAId,
                customerServiceId: ghlCustomerServiceAId,
                createdByUserId: platformUserId,
              },
              tx,
            ),
          )
            .then(() => "fulfilled" as const)
            .catch((error: unknown) => ({
              status: "rejected" as const,
              diagnostic: errorDiagnostic(error),
            }));
        const results = await Promise.all([attempt(idA), attempt(idB)]);
        expect(results.filter((result) => result === "fulfilled")).toHaveLength(
          1,
        );
        const rejected = results.find((result) => result !== "fulfilled");
        expect(rejected).toBeDefined();
        if (rejected !== undefined)
          expect(rejected.diagnostic).toContain("P2002");
      });

      it("allows exactly one winner in a real concurrent external-asset-ID race", async () => {
        const workspaceId = await createWorkspace(await createEngagement());
        const externalAssetId = `race-${generateId()}`;
        const idA = generateId();
        const idB = generateId();
        assetIds.push(idA, idB);
        const attempt = (id: string) =>
          withTenantContext(platformContext(), (tx) =>
            ghlAssetRepository.create(
              assetInput(id, workspaceId, organizationAId, { externalAssetId }),
              tx,
            ),
          )
            .then(() => "fulfilled" as const)
            .catch((error: unknown) => ({
              status: "rejected" as const,
              diagnostic: errorDiagnostic(error),
            }));
        const results = await Promise.all([attempt(idA), attempt(idB)]);
        expect(results.filter((result) => result === "fulfilled")).toHaveLength(
          1,
        );
        const rejected = results.find((result) => result !== "fulfilled");
        expect(rejected).toBeDefined();
        if (rejected !== undefined)
          expect(rejected.diagnostic).toContain("P2002");
      });
    });

    describe("CHECK constraints", () => {
      it("rejects all-whitespace workspace, asset, and integration requirement names", async () => {
        const engagementId = await createEngagement();
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlWorkspaceRepository.create(
              workspaceInput(generateId(), engagementId, organizationAId, {
                name: "   ",
              }),
              tx,
            ),
          ),
          "23514",
          "ghl_workspaces_name_non_blank_check",
        );

        const workspaceId = await createWorkspace(engagementId);
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlAssetRepository.create(
              assetInput(generateId(), workspaceId, organizationAId, {
                name: "   ",
              }),
              tx,
            ),
          ),
          "23514",
          "ghl_assets_name_non_blank_check",
        );
        await expectPgError(
          withTenantContext(platformContext(), (tx) =>
            ghlIntegrationRequirementRepository.create(
              integrationRequirementInput(
                generateId(),
                workspaceId,
                organizationAId,
                "   ",
              ),
              tx,
            ),
          ),
          "23514",
          "ghl_integration_requirements_name_non_blank_check",
        );
      });

      it("rejects impossible and every kind of negative import row count", async () => {
        const workspaceId = await createWorkspace(await createEngagement());
        const invalidCounts = [
          { totalRowCount: 1, importedRowCount: 1, skippedRowCount: 1 },
          { totalRowCount: -1, importedRowCount: 0, skippedRowCount: 0 },
          { totalRowCount: 1, importedRowCount: -1, skippedRowCount: 0 },
          { totalRowCount: 1, importedRowCount: 0, skippedRowCount: -1 },
        ];
        for (const counts of invalidCounts) {
          await expectPgError(
            withTenantContext(platformContext(), (tx) =>
              ghlImportBatchRepository.create(
                importBatchInput(
                  generateId(),
                  workspaceId,
                  organizationAId,
                  counts,
                ),
                tx,
              ),
            ),
            "23514",
            "ghl_import_batches_row_counts_check",
          );
        }
      });
    });

    describe("defense-in-depth for forged relationships", () => {
      it("proves forced WITH CHECK policies independently require platform tenant ownership", async () => {
        const policies = await withTenantContext(
          platformContext(),
          (tx) =>
            tx.$queryRaw<
              Array<{
                table_name: string;
                row_security: boolean;
                force_row_security: boolean;
                with_check: string;
              }>
            >`
          SELECT c.relname AS table_name,
                 c.relrowsecurity AS row_security,
                 c.relforcerowsecurity AS force_row_security,
                 pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND p.polname = 'tenant_isolation_insert'
            AND c.relname IN ('ghl_assets', 'ghl_integration_requirements', 'ghl_import_batches')
          ORDER BY c.relname
        `,
        );
        expect(policies.map((policy) => policy.table_name)).toEqual([
          "ghl_assets",
          "ghl_import_batches",
          "ghl_integration_requirements",
        ]);
        for (const policy of policies) {
          expect(policy.row_security).toBe(true);
          expect(policy.force_row_security).toBe(true);
          expect(policy.with_check).toContain(
            "organization_id = tenant_current_organization_id()",
          );
          expect(policy.with_check).toContain("tenant_is_platform_context()");
        }
      });

      it("operationally rejects forged parent organizations in every child BEFORE trigger", async () => {
        const workspaceId = await createWorkspace(await createEngagement());
        const attempts: Array<
          [(tx: TenantTransactionClient) => Promise<unknown>, string]
        > = [
          [
            (tx) =>
              tx.ghlAsset.create({
                data: assetInput(generateId(), workspaceId, organizationBId),
              }),
            "GHL asset organization must match its workspace organization",
          ],
          [
            (tx) =>
              tx.ghlIntegrationRequirement.create({
                data: integrationRequirementInput(
                  generateId(),
                  workspaceId,
                  organizationBId,
                ),
              }),
            "GHL integration requirement organization must match its workspace organization",
          ],
          [
            (tx) =>
              tx.ghlImportBatch.create({
                data: importBatchInput(
                  generateId(),
                  workspaceId,
                  organizationBId,
                ),
              }),
            "GHL import batch organization must match its workspace organization",
          ],
        ];
        for (const [attempt, message] of attempts)
          await expectPgError(
            withTenantContext(platformContext(organizationBId), attempt),
            "23514",
            message,
          );
      });
    });
  },
);
