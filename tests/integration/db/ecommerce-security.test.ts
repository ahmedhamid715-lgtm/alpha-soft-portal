import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput, type TenantTransactionClient } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { ecommerceCollectionProductRepository, ecommerceCollectionRepository } from "@/server/repositories/ecommerce-collection-repository";
import { ecommerceEngagementRepository } from "@/server/repositories/ecommerce-engagement-repository";
import { ecommerceImportBatchRepository } from "@/server/repositories/ecommerce-import-batch-repository";
import { ecommerceProductRepository } from "@/server/repositories/ecommerce-product-repository";
import { ecommerceStoreRepository } from "@/server/repositories/ecommerce-store-repository";
import { ecommerceVariantRepository } from "@/server/repositories/ecommerce-variant-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { websiteEngagementRepository } from "@/server/repositories/website-engagement-repository";
import { websiteSiteRepository } from "@/server/repositories/website-site-repository";

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

const ECOMMERCE_TABLES = [
  "ecommerce_engagements",
  "ecommerce_stores",
  "ecommerce_products",
  "ecommerce_variants",
  "ecommerce_collections",
  "ecommerce_collection_products",
  "ecommerce_import_batches",
] as const;

type EcommerceGraph = {
  engagementId: string;
  storeId: string;
  productId: string;
  variantId: string;
  collectionId: string;
  collectionProductId: string;
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

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("E-Commerce Development database security (Build 33)", () => {
  let organizationAId: string;
  let organizationBId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;
  let companyAId: string;
  let companyBId: string;
  let ecommerceDefinitionAId: string;
  let ecommerceDefinitionBId: string;
  let webDefinitionAId: string;
  let webDefinitionBId: string;
  let seoDefinitionId: string;
  let ecommerceCustomerServiceAId: string;
  let ecommerceCustomerServiceBId: string;
  let webCustomerServiceAId: string;
  let webCustomerServiceBId: string;
  let seoCustomerServiceId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const definitionIds: string[] = [];
  const customerServiceIds: string[] = [];
  const ecommerceEngagementIds: string[] = [];
  const storeIds: string[] = [];
  const productIds: string[] = [];
  const variantIds: string[] = [];
  const collectionIds: string[] = [];
  const collectionProductIds: string[] = [];
  const importBatchIds: string[] = [];
  const websiteEngagementIds: string[] = [];
  const websiteSiteIds: string[] = [];

  const platformContext = (organizationId = organizationAId): TenantContextInput => ({ userId: platformUserId, organizationId, isPlatformStaff: true });

  beforeEach(async () => {
    organizationAId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!organizationAId) {
      organizationAId = generateId();
      organizationIds.push(organizationAId);
      await db.organization.create({ data: { id: organizationAId, name: "Platform", displayName: "Platform", slug: `ecommerce-platform-${organizationAId}`, isPlatform: true } });
    }

    organizationBId = await createOrganization("Ecommerce Owner B");
    customerOrgAId = await createOrganization("Ecommerce Customer A");
    customerOrgBId = await createOrganization("Ecommerce Customer B");
    platformUserId = generateId();
    userIds.push(platformUserId);
    await userRepository.create({ id: platformUserId, email: `ecommerce-rls-${platformUserId}@example.com`, name: `Ecommerce RLS Actor ${platformUserId}` });

    companyAId = generateId();
    companyBId = generateId();
    companyIds.push(companyAId, companyBId);
    ecommerceDefinitionAId = generateId();
    ecommerceDefinitionBId = generateId();
    webDefinitionAId = generateId();
    webDefinitionBId = generateId();
    seoDefinitionId = generateId();
    definitionIds.push(ecommerceDefinitionAId, ecommerceDefinitionBId, webDefinitionAId, webDefinitionBId, seoDefinitionId);
    ecommerceCustomerServiceAId = generateId();
    ecommerceCustomerServiceBId = generateId();
    webCustomerServiceAId = generateId();
    webCustomerServiceBId = generateId();
    seoCustomerServiceId = generateId();
    customerServiceIds.push(ecommerceCustomerServiceAId, ecommerceCustomerServiceBId, webCustomerServiceAId, webCustomerServiceBId, seoCustomerServiceId);

    await withTenantContext(platformContext(organizationAId), async (tx) => {
      await crmCompanyRepository.create({ id: companyAId, organizationId: organizationAId, name: `Ecommerce Company A ${companyAId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyAId, customerOrgAId, tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(ecommerceDefinitionAId, organizationAId, "ECOMMERCE", "ONE_TIME", 0), tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(webDefinitionAId, organizationAId, "WEB_DEVELOPMENT", "ONE_TIME", 1), tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(seoDefinitionId, organizationAId, "SEO", "RECURRING", 2), tx);
      await customerServiceRepository.create(customerServiceInput(ecommerceCustomerServiceAId, organizationAId, customerOrgAId, companyAId, ecommerceDefinitionAId), tx);
      await customerServiceRepository.create(customerServiceInput(webCustomerServiceAId, organizationAId, customerOrgAId, companyAId, webDefinitionAId), tx);
      await customerServiceRepository.create(customerServiceInput(seoCustomerServiceId, organizationAId, customerOrgAId, companyAId, seoDefinitionId), tx);
    });

    await withTenantContext(platformContext(organizationBId), async (tx) => {
      await crmCompanyRepository.create({ id: companyBId, organizationId: organizationBId, name: `Ecommerce Company B ${companyBId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyBId, customerOrgBId, tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(ecommerceDefinitionBId, organizationBId, "ECOMMERCE", "ONE_TIME", 0), tx);
      await serviceDefinitionRepository.create(serviceDefinitionInput(webDefinitionBId, organizationBId, "WEB_DEVELOPMENT", "ONE_TIME", 1), tx);
      await customerServiceRepository.create(customerServiceInput(ecommerceCustomerServiceBId, organizationBId, customerOrgBId, companyBId, ecommerceDefinitionBId), tx);
      await customerServiceRepository.create(customerServiceInput(webCustomerServiceBId, organizationBId, customerOrgBId, companyBId, webDefinitionBId), tx);
    });
  });

  afterEach(async () => {
    if (variantIds.length) await db.ecommerceVariant.deleteMany({ where: { id: { in: variantIds } } });
    if (collectionProductIds.length) await db.ecommerceCollectionProduct.deleteMany({ where: { id: { in: collectionProductIds } } });
    if (collectionIds.length) await db.ecommerceCollection.deleteMany({ where: { id: { in: collectionIds } } });
    if (productIds.length) await db.ecommerceProduct.deleteMany({ where: { id: { in: productIds } } });
    if (importBatchIds.length) await db.ecommerceImportBatch.deleteMany({ where: { id: { in: importBatchIds } } });
    if (storeIds.length) await db.ecommerceStore.deleteMany({ where: { id: { in: storeIds } } });
    if (ecommerceEngagementIds.length) await db.ecommerceEngagement.deleteMany({ where: { id: { in: ecommerceEngagementIds } } });
    if (websiteSiteIds.length) await db.websiteSite.deleteMany({ where: { id: { in: websiteSiteIds } } });
    if (websiteEngagementIds.length) await db.websiteEngagement.deleteMany({ where: { id: { in: websiteEngagementIds } } });
    if (customerServiceIds.length) await db.customerService.deleteMany({ where: { id: { in: customerServiceIds } } });
    if (definitionIds.length) await db.serviceDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });

    for (const ids of [
      variantIds,
      collectionProductIds,
      collectionIds,
      productIds,
      importBatchIds,
      storeIds,
      ecommerceEngagementIds,
      websiteSiteIds,
      websiteEngagementIds,
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
    await organizationRepository.create({ id, name, displayName: name, slug: `ecommerce-rls-${id}` });
    return id;
  }

  function serviceDefinitionInput(
    id: string,
    organizationId: string,
    category: "ECOMMERCE" | "WEB_DEVELOPMENT" | "SEO",
    deliveryCadence: "ONE_TIME" | "RECURRING",
    sortOrder: number,
  ) {
    return { id, organizationId, name: `${category} ${id}`, code: `${category}-${id}`, description: null, category, deliveryCadence, sortOrder };
  }

  function customerServiceInput(id: string, organizationId: string, customerOrganizationId: string, companyId: string, serviceDefinitionId: string) {
    return { id, organizationId, customerOrganizationId, companyId, serviceDefinitionId, sourceOnboardingServiceItemId: null, quantity: 1, ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId };
  }

  async function createEcommerceEngagement(customerServiceId = ecommerceCustomerServiceAId, organizationId = organizationAId): Promise<string> {
    const id = generateId();
    ecommerceEngagementIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceEngagementRepository.create({ id, organizationId, customerServiceId, createdByUserId: platformUserId }, tx));
    return id;
  }

  async function createWebsiteEngagement(customerServiceId = webCustomerServiceAId, organizationId = organizationAId): Promise<string> {
    const id = generateId();
    websiteEngagementIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => websiteEngagementRepository.create({ id, organizationId, customerServiceId, createdByUserId: platformUserId }, tx));
    return id;
  }

  function storeInput(id: string, engagementId: string, organizationId = organizationAId, overrides: Partial<{ name: string; externalStoreIdentifier: string | null; websiteSiteId: string | null }> = {}) {
    return {
      id,
      organizationId,
      engagementId,
      name: overrides.name ?? `Store ${id}`,
      platform: "OTHER" as const,
      externalStoreIdentifier: overrides.externalStoreIdentifier ?? null,
      websiteSiteId: overrides.websiteSiteId ?? null,
      storeUrl: null,
      currency: "USD",
      createdByUserId: platformUserId,
    };
  }

  async function createStore(engagementId: string, organizationId = organizationAId, overrides: Partial<{ name: string; externalStoreIdentifier: string | null; websiteSiteId: string | null }> = {}): Promise<string> {
    const id = generateId();
    storeIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceStoreRepository.create(storeInput(id, engagementId, organizationId, overrides), tx));
    return id;
  }

  function productInput(
    id: string,
    storeId: string,
    organizationId = organizationAId,
    overrides: Partial<{ title: string; handle: string | null; externalProductId: string | null; importBatchId: string | null }> = {},
  ) {
    return {
      id,
      organizationId,
      storeId,
      title: overrides.title ?? `Product ${id}`,
      handle: overrides.handle ?? null,
      externalProductId: overrides.externalProductId ?? null,
      productType: null,
      vendor: null,
      source: "MANUAL" as const,
      requiredForLaunch: true,
      sortOrder: 0,
      primaryImageUrl: null,
      importBatchId: overrides.importBatchId ?? null,
      createdByUserId: platformUserId,
    };
  }

  async function createProduct(storeId: string, organizationId = organizationAId, overrides: Partial<{ title: string; handle: string | null; externalProductId: string | null; importBatchId: string | null }> = {}): Promise<string> {
    const id = generateId();
    productIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceProductRepository.create(productInput(id, storeId, organizationId, overrides), tx));
    return id;
  }

  function variantInput(
    id: string,
    productId: string,
    storeId: string,
    organizationId = organizationAId,
    overrides: Partial<{ title: string; sku: string | null; priceMinorUnits: number | null; compareAtPriceMinorUnits: number | null }> = {},
  ) {
    return {
      id,
      organizationId,
      productId,
      storeId,
      title: overrides.title ?? `Variant ${id}`,
      externalVariantId: null,
      sku: overrides.sku ?? null,
      option1Name: null,
      option1Value: null,
      option2Name: null,
      option2Value: null,
      option3Name: null,
      option3Value: null,
      priceMinorUnits: overrides.priceMinorUnits ?? null,
      compareAtPriceMinorUnits: overrides.compareAtPriceMinorUnits ?? null,
      createdByUserId: platformUserId,
    };
  }

  async function createVariant(productId: string, storeId: string, organizationId = organizationAId, overrides: Partial<{ title: string; sku: string | null; priceMinorUnits: number | null; compareAtPriceMinorUnits: number | null }> = {}): Promise<string> {
    const id = generateId();
    variantIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceVariantRepository.create(variantInput(id, productId, storeId, organizationId, overrides), tx));
    return id;
  }

  async function createCollection(storeId: string, organizationId = organizationAId, overrides: Partial<{ title: string; handle: string | null }> = {}): Promise<string> {
    const id = generateId();
    collectionIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceCollectionRepository.create({ id, organizationId, storeId, title: overrides.title ?? `Collection ${id}`, handle: overrides.handle ?? null, createdByUserId: platformUserId }, tx));
    return id;
  }

  async function createCollectionProduct(collectionId: string, productId: string, organizationId = organizationAId): Promise<string> {
    const id = generateId();
    collectionProductIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceCollectionProductRepository.create({ id, organizationId, collectionId, productId, sortOrder: 0 }, tx));
    return id;
  }

  async function createImportBatch(storeId: string, organizationId = organizationAId, overrides: Partial<{ totalRowCount: number; importedRowCount: number; skippedRowCount: number }> = {}): Promise<string> {
    const id = generateId();
    importBatchIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => ecommerceImportBatchRepository.create({ id, organizationId, storeId, importedByUserId: platformUserId, totalRowCount: overrides.totalRowCount ?? 2, importedRowCount: overrides.importedRowCount ?? 1, skippedRowCount: overrides.skippedRowCount ?? 1 }, tx));
    return id;
  }

  function websiteSiteInput(id: string, engagementId: string, organizationId: string) {
    return {
      id,
      organizationId,
      engagementId,
      name: `Website ${id}`,
      primaryUrl: `https://${id}.example.test`,
      normalizedPrimaryOrigin: `https://${id}.example.test`,
      siteType: "STANDARD" as const,
      platform: "CUSTOM_NEXTJS" as const,
      technologyNotes: null,
      repositoryUrl: null,
      analyticsConfigured: "UNKNOWN" as const,
      tagManagerConfigured: "UNKNOWN" as const,
      createdByUserId: platformUserId,
    };
  }

  async function createWebsiteSite(engagementId: string, organizationId = organizationAId): Promise<string> {
    const id = generateId();
    websiteSiteIds.push(id);
    await withTenantContext(platformContext(organizationId), (tx) => websiteSiteRepository.create(websiteSiteInput(id, engagementId, organizationId), tx));
    return id;
  }

  async function seedFullGraph(): Promise<EcommerceGraph> {
    const engagementId = await createEcommerceEngagement();
    const storeId = await createStore(engagementId);
    const importBatchId = await createImportBatch(storeId);
    const productId = await createProduct(storeId, organizationAId, { importBatchId });
    const variantId = await createVariant(productId, storeId);
    const collectionId = await createCollection(storeId);
    const collectionProductId = await createCollectionProduct(collectionId, productId);
    return { engagementId, storeId, productId, variantId, collectionId, collectionProductId, importBatchId };
  }

  async function countsForAllTables(context: TenantContextInput): Promise<Record<(typeof ECOMMERCE_TABLES)[number], number>> {
    return withTenantContext(context, async (tx) => ({
      ecommerce_engagements: await tx.ecommerceEngagement.count(),
      ecommerce_stores: await tx.ecommerceStore.count(),
      ecommerce_products: await tx.ecommerceProduct.count(),
      ecommerce_variants: await tx.ecommerceVariant.count(),
      ecommerce_collections: await tx.ecommerceCollection.count(),
      ecommerce_collection_products: await tx.ecommerceCollectionProduct.count(),
      ecommerce_import_batches: await tx.ecommerceImportBatch.count(),
    }));
  }

  describe("RLS and grants", () => {
    it("uses the genuinely restricted alpha_os_app role", async () => {
      const [role] = await withTenantContext(platformContext(), (tx) => tx.$queryRaw<Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>>`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(role).toEqual({ current_user: "alpha_os_app", rolsuper: false, rolbypassrls: false });
    });

    it("fails closed with no tenant context on all seven Ecommerce tables", async () => {
      await seedFullGraph();
      expect(await countsForAllTables(NO_TENANT_CONTEXT)).toEqual(Object.fromEntries(ECOMMERCE_TABLES.map((table) => [table, 0])));
    });

    it("hides all seven tables from either bare customer-organization context", async () => {
      await seedFullGraph();
      for (const organizationId of [customerOrgAId, customerOrgBId]) {
        expect(await countsForAllTables({ userId: platformUserId, organizationId, isPlatformStaff: false })).toEqual(Object.fromEntries(ECOMMERCE_TABLES.map((table) => [table, 0])));
      }
    });

    it("rejects raw DELETE statements against all seven tables", async () => {
      const graph = await seedFullGraph();
      const ids: Record<(typeof ECOMMERCE_TABLES)[number], string> = {
        ecommerce_engagements: graph.engagementId,
        ecommerce_stores: graph.storeId,
        ecommerce_products: graph.productId,
        ecommerce_variants: graph.variantId,
        ecommerce_collections: graph.collectionId,
        ecommerce_collection_products: graph.collectionProductId,
        ecommerce_import_batches: graph.importBatchId,
      };
      for (const table of ECOMMERCE_TABLES) {
        await expectPgError(withTenantContext(platformContext(), (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = $1::uuid`, ids[table])), "42501", `permission denied for table ${table}`);
      }
    });

    it("keeps import batches append-only while the other six tables remain mutable", async () => {
      const graph = await seedFullGraph();
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.$executeRaw`UPDATE ecommerce_import_batches SET total_row_count = 3 WHERE id = ${graph.importBatchId}::uuid`), "42501", "permission denied for table ecommerce_import_batches");

      await withTenantContext(platformContext(), async (tx) => {
        expect(await tx.$executeRaw`UPDATE ecommerce_engagements SET updated_at = NOW() WHERE id = ${graph.engagementId}::uuid`).toBe(1);
        expect((await ecommerceStoreRepository.update(graph.storeId, { name: "Updated store" }, tx)).name).toBe("Updated store");
        expect((await ecommerceProductRepository.update(graph.productId, { title: "Updated product" }, tx)).title).toBe("Updated product");
        expect((await ecommerceVariantRepository.update(graph.variantId, { title: "Updated variant" }, tx)).title).toBe("Updated variant");
        expect((await ecommerceCollectionRepository.update(graph.collectionId, { title: "Updated collection" }, tx)).title).toBe("Updated collection");
        expect(await tx.$executeRaw`UPDATE ecommerce_collection_products SET sort_order = 7 WHERE id = ${graph.collectionProductId}::uuid`).toBe(1);
      });
    });
  });

  describe("category relationship integrity", () => {
    it("accepts ECOMMERCE and rejects both WEB_DEVELOPMENT and SEO CustomerServices with SQLSTATE 23514", async () => {
      const acceptedId = await createEcommerceEngagement();
      expect((await withTenantContext(platformContext(), (tx) => ecommerceEngagementRepository.findById(acceptedId, tx)))?.customerServiceId).toBe(ecommerceCustomerServiceAId);

      for (const customerServiceId of [webCustomerServiceAId, seoCustomerServiceId]) {
        const id = generateId();
        ecommerceEngagementIds.push(id);
        await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceEngagementRepository.create({ id, organizationId: organizationAId, customerServiceId, createdByUserId: platformUserId }, tx)), "23514", "must use a service definition with category ECOMMERCE");
      }
    });

    it("uses its own trigger function rather than Website Dev, SEO OS, or Local SEO logic", async () => {
      const functions = await withTenantContext(platformContext(), (tx) =>
        tx.$queryRaw<Array<{ oid: string; proname: string; definition: string }>>`
          SELECT p.oid::text AS oid, p.proname, pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = current_schema()
            AND p.proname IN (
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
        "local_seo_engagements_enforce_relationship_integrity",
        "seo_engagements_enforce_relationship_integrity",
        "website_engagements_enforce_relationship_integrity",
      ]);
      expect(new Set(functions.map((fn) => fn.oid)).size).toBe(4);
      expect(functions.find((fn) => fn.proname.startsWith("ecommerce_"))?.definition).toContain("'ECOMMERCE'::service_category");
      expect(functions.find((fn) => fn.proname.startsWith("website_"))?.definition).toContain("'WEB_DEVELOPMENT'::service_category");
      expect(functions.find((fn) => fn.proname === "seo_engagements_enforce_relationship_integrity")?.definition).toContain("'SEO'::service_category");
      expect(functions.find((fn) => fn.proname.startsWith("local_seo_"))?.definition).toContain("'LOCAL_SEO'::service_category");
      expect(new Set(functions.map((fn) => fn.definition)).size).toBe(4);
    });
  });

  describe("organization-integrity triggers", () => {
    it("rejects forged organization IDs for each of the six child tables with SQLSTATE 23514", async () => {
      const engagementAId = await createEcommerceEngagement();
      const engagementBId = await createEcommerceEngagement(ecommerceCustomerServiceBId, organizationBId);
      const storeAId = await createStore(engagementAId);
      const storeBId = await createStore(engagementBId, organizationBId);
      const productAId = await createProduct(storeAId);
      const productBId = await createProduct(storeBId, organizationBId);
      const collectionAId = await createCollection(storeAId);

      const attempts: Array<[string, (tx: TenantTransactionClient) => Promise<unknown>, string]> = [
        ["ecommerce_stores", (tx) => tx.ecommerceStore.create({ data: storeInput(generateId(), engagementAId, organizationBId) }), "Ecommerce store organization must match its engagement organization"],
        ["ecommerce_products", (tx) => tx.ecommerceProduct.create({ data: productInput(generateId(), storeAId, organizationBId) }), "Ecommerce product organization must match its store organization"],
        ["ecommerce_variants", (tx) => tx.ecommerceVariant.create({ data: variantInput(generateId(), productAId, storeAId, organizationBId) }), "Ecommerce variant organization must match its product organization"],
        ["ecommerce_collections", (tx) => tx.ecommerceCollection.create({ data: { id: generateId(), organizationId: organizationBId, storeId: storeAId, title: "Forged collection", handle: null, createdByUserId: platformUserId } }), "Ecommerce collection organization must match its store organization"],
        ["ecommerce_collection_products", (tx) => tx.ecommerceCollectionProduct.create({ data: { id: generateId(), organizationId: organizationBId, collectionId: collectionAId, productId: productAId, sortOrder: 0 } }), "Ecommerce collection product organization must match its collection organization"],
        ["ecommerce_import_batches", (tx) => tx.ecommerceImportBatch.create({ data: { id: generateId(), organizationId: organizationBId, storeId: storeAId, importedByUserId: platformUserId, totalRowCount: 0, importedRowCount: 0, skippedRowCount: 0 } }), "Ecommerce import batch organization must match its store organization"],
      ];

      for (const [label, attempt, message] of attempts) {
        await expectPgError(withTenantContext(platformContext(), attempt), "23514", message);
        expect(label).toBeTruthy();
      }
      expect(storeAId).not.toBe(storeBId);
      expect(productAId).not.toBe(productBId);
    });
  });

  describe("Store to WebsiteSite cross-customer defense", () => {
    it("rejects Customer A to Customer B, accepts the same customer/company, and enforces one store per site", async () => {
      const ecommerceEngagementAId = await createEcommerceEngagement();
      const ecommerceEngagementBId = await createEcommerceEngagement(ecommerceCustomerServiceBId, organizationBId);
      const websiteEngagementAId = await createWebsiteEngagement();
      const websiteEngagementBId = await createWebsiteEngagement(webCustomerServiceBId, organizationBId);
      const siteAId = await createWebsiteSite(websiteEngagementAId);
      const siteBId = await createWebsiteSite(websiteEngagementBId, organizationBId);

      const crossCustomerStoreId = generateId();
      storeIds.push(crossCustomerStoreId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.create(storeInput(crossCustomerStoreId, ecommerceEngagementAId, organizationAId, { websiteSiteId: siteBId }), tx)),
        "23514",
        "Ecommerce store organization must match its linked website site organization",
      );

      const linkedStoreId = await createStore(ecommerceEngagementAId, organizationAId, { websiteSiteId: siteAId });
      expect((await withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.findById(linkedStoreId, tx)))?.websiteSiteId).toBe(siteAId);

      const duplicateStoreId = generateId();
      storeIds.push(duplicateStoreId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.create(storeInput(duplicateStoreId, ecommerceEngagementAId, organizationAId, { websiteSiteId: siteAId }), tx)), "P2002");
      expect(ecommerceEngagementBId).not.toBe(ecommerceEngagementAId);
    });

    it("rejects a linked site when only customer_organization_id differs", async () => {
      const customerXId = await createOrganization("Customer-only mismatch X");
      const customerYId = await createOrganization("Customer-only mismatch Y");
      const companyId = generateId();
      companyIds.push(companyId);
      const ecommerceServiceId = generateId();
      const websiteServiceId = generateId();
      customerServiceIds.push(ecommerceServiceId, websiteServiceId);

      await withTenantContext(platformContext(), async (tx) => {
        await crmCompanyRepository.create({ id: companyId, organizationId: organizationAId, name: `Customer-only company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
        await crmCompanyRepository.linkToOrganization(companyId, customerXId, tx);
        await customerServiceRepository.create(customerServiceInput(ecommerceServiceId, organizationAId, customerXId, companyId, ecommerceDefinitionAId), tx);
      });
      await db.crmCompany.update({ where: { id: companyId }, data: { convertedToOrganizationId: customerYId } });
      await withTenantContext(platformContext(), (tx) => customerServiceRepository.create(customerServiceInput(websiteServiceId, organizationAId, customerYId, companyId, webDefinitionAId), tx));

      const ecommerceEngagementId = await createEcommerceEngagement(ecommerceServiceId);
      const websiteSiteId = await createWebsiteSite(await createWebsiteEngagement(websiteServiceId));
      const storeId = generateId();
      storeIds.push(storeId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.create(storeInput(storeId, ecommerceEngagementId, organizationAId, { websiteSiteId }), tx)), "23514", "must belong to the same customer and company");
    });

    it("rejects a linked site when only company_id differs", async () => {
      const customerXId = await createOrganization("Company-only mismatch customer");
      const temporaryCustomerId = await createOrganization("Company-only mismatch temporary customer");
      const ecommerceCompanyId = generateId();
      const websiteCompanyId = generateId();
      companyIds.push(ecommerceCompanyId, websiteCompanyId);
      const ecommerceServiceId = generateId();
      const websiteServiceId = generateId();
      customerServiceIds.push(ecommerceServiceId, websiteServiceId);

      await withTenantContext(platformContext(), async (tx) => {
        await crmCompanyRepository.create({ id: ecommerceCompanyId, organizationId: organizationAId, name: `Ecommerce-only company ${ecommerceCompanyId}`, domain: null, industry: null, website: null, phone: null }, tx);
        await crmCompanyRepository.linkToOrganization(ecommerceCompanyId, customerXId, tx);
        await customerServiceRepository.create(customerServiceInput(ecommerceServiceId, organizationAId, customerXId, ecommerceCompanyId, ecommerceDefinitionAId), tx);
      });
      await db.crmCompany.update({ where: { id: ecommerceCompanyId }, data: { convertedToOrganizationId: temporaryCustomerId } });
      await withTenantContext(platformContext(), async (tx) => {
        await crmCompanyRepository.create({ id: websiteCompanyId, organizationId: organizationAId, name: `Website-only company ${websiteCompanyId}`, domain: null, industry: null, website: null, phone: null }, tx);
        await crmCompanyRepository.linkToOrganization(websiteCompanyId, customerXId, tx);
        await customerServiceRepository.create(customerServiceInput(websiteServiceId, organizationAId, customerXId, websiteCompanyId, webDefinitionAId), tx);
      });

      const ecommerceEngagementId = await createEcommerceEngagement(ecommerceServiceId);
      const websiteSiteId = await createWebsiteSite(await createWebsiteEngagement(websiteServiceId));
      const storeId = generateId();
      storeIds.push(storeId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.create(storeInput(storeId, ecommerceEngagementId, organizationAId, { websiteSiteId }), tx)), "23514", "must belong to the same customer and company");
    });
  });

  describe("idempotency and uniqueness", () => {
    it("rejects a second engagement for the same CustomerService", async () => {
      await createEcommerceEngagement();
      const id = generateId();
      ecommerceEngagementIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceEngagementRepository.create({ id, organizationId: organizationAId, customerServiceId: ecommerceCustomerServiceAId, createdByUserId: platformUserId }, tx)), "P2002");
    });

    it("deduplicates known external store identifiers but permits multiple NULL identifiers", async () => {
      const engagementId = await createEcommerceEngagement();
      const externalStoreIdentifier = `store-${generateId()}`;
      await createStore(engagementId, organizationAId, { externalStoreIdentifier });
      const duplicateId = generateId();
      storeIds.push(duplicateId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.create(storeInput(duplicateId, engagementId, organizationAId, { externalStoreIdentifier }), tx)), "P2002");

      const nullAId = await createStore(engagementId);
      const nullBId = await createStore(engagementId);
      expect(await withTenantContext(platformContext(), (tx) => tx.ecommerceStore.count({ where: { id: { in: [nullAId, nullBId] }, externalStoreIdentifier: null } }))).toBe(2);
    });

    it("enforces product handle and external-product uniqueness while allowing NULL handles", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const handle = `handle-${generateId()}`;
      await createProduct(storeId, organizationAId, { handle, externalProductId: `external-${generateId()}` });

      const duplicateHandleId = generateId();
      productIds.push(duplicateHandleId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceProductRepository.create(productInput(duplicateHandleId, storeId, organizationAId, { handle, externalProductId: `other-${generateId()}` }), tx)), "P2002");

      const externalProductId = `external-duplicate-${generateId()}`;
      await createProduct(storeId, organizationAId, { handle: `first-${generateId()}`, externalProductId });
      const duplicateExternalId = generateId();
      productIds.push(duplicateExternalId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceProductRepository.create(productInput(duplicateExternalId, storeId, organizationAId, { handle: `second-${generateId()}`, externalProductId }), tx)), "P2002");

      const nullAId = await createProduct(storeId);
      const nullBId = await createProduct(storeId);
      expect(await withTenantContext(platformContext(), (tx) => tx.ecommerceProduct.count({ where: { id: { in: [nullAId, nullBId] }, handle: null } }))).toBe(2);
    });

    it("enforces variant SKU uniqueness while allowing multiple NULL SKUs", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const productId = await createProduct(storeId);
      const sku = `SKU-${generateId()}`;
      await createVariant(productId, storeId, organizationAId, { sku });
      const duplicateId = generateId();
      variantIds.push(duplicateId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceVariantRepository.create(variantInput(duplicateId, productId, storeId, organizationAId, { sku }), tx)), "P2002");

      const nullAId = await createVariant(productId, storeId);
      const nullBId = await createVariant(productId, storeId);
      expect(await withTenantContext(platformContext(), (tx) => tx.ecommerceVariant.count({ where: { id: { in: [nullAId, nullBId] }, sku: null } }))).toBe(2);
    });

    it("enforces collection-handle and collection-product uniqueness", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const productId = await createProduct(storeId);
      const handle = `collection-${generateId()}`;
      const collectionId = await createCollection(storeId, organizationAId, { handle });
      const duplicateCollectionId = generateId();
      collectionIds.push(duplicateCollectionId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceCollectionRepository.create({ id: duplicateCollectionId, organizationId: organizationAId, storeId, title: "Duplicate collection", handle, createdByUserId: platformUserId }, tx)), "P2002");

      await createCollectionProduct(collectionId, productId);
      const duplicateMembershipId = generateId();
      collectionProductIds.push(duplicateMembershipId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceCollectionProductRepository.create({ id: duplicateMembershipId, organizationId: organizationAId, collectionId, productId, sortOrder: 1 }, tx)), "P2002");
    });

    it("allows exactly one winner in a real concurrent engagement race", async () => {
      const idA = generateId();
      const idB = generateId();
      ecommerceEngagementIds.push(idA, idB);
      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) => ecommerceEngagementRepository.create({ id, organizationId: organizationAId, customerServiceId: ecommerceCustomerServiceAId, createdByUserId: platformUserId }, tx))
          .then(() => "fulfilled" as const)
          .catch((error: unknown) => ({ status: "rejected" as const, diagnostic: errorDiagnostic(error) }));
      const results = await Promise.all([attempt(idA), attempt(idB)]);
      expect(results.filter((result) => result === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result !== "fulfilled");
      expect(rejected).toBeDefined();
      if (rejected !== undefined) expect(rejected.diagnostic).toContain("P2002");
    });

    it("allows exactly one winner in a real concurrent product-handle race", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const handle = `race-${generateId()}`;
      const idA = generateId();
      const idB = generateId();
      productIds.push(idA, idB);
      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) => ecommerceProductRepository.create(productInput(id, storeId, organizationAId, { handle } ), tx))
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
    it("rejects all-whitespace store, product, variant, and collection titles", async () => {
      const engagementId = await createEcommerceEngagement();
      const blankStoreId = generateId();
      storeIds.push(blankStoreId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceStoreRepository.create(storeInput(blankStoreId, engagementId, organizationAId, { name: "   " }), tx)), "23514", "ecommerce_stores_name_non_blank_check");

      const storeId = await createStore(engagementId);
      const blankProductId = generateId();
      productIds.push(blankProductId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceProductRepository.create(productInput(blankProductId, storeId, organizationAId, { title: "   " }), tx)), "23514", "ecommerce_products_title_non_blank_check");

      const productId = await createProduct(storeId);
      const blankVariantId = generateId();
      variantIds.push(blankVariantId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceVariantRepository.create(variantInput(blankVariantId, productId, storeId, organizationAId, { title: "   " }), tx)), "23514", "ecommerce_variants_title_non_blank_check");

      const blankCollectionId = generateId();
      collectionIds.push(blankCollectionId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceCollectionRepository.create({ id: blankCollectionId, organizationId: organizationAId, storeId, title: "   ", handle: null, createdByUserId: platformUserId }, tx)), "23514", "ecommerce_collections_title_non_blank_check");
    });

    it("rejects negative variant price fields", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const productId = await createProduct(storeId);
      for (const overrides of [{ priceMinorUnits: -1 }, { compareAtPriceMinorUnits: -1 }]) {
        const id = generateId();
        variantIds.push(id);
        await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceVariantRepository.create(variantInput(id, productId, storeId, organizationAId, overrides), tx)), "23514", "ecommerce_variants_price_non_negative_check");
      }
    });

    it("rejects compare-at below price and accepts equal or greater values", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const productId = await createProduct(storeId);
      const invalidId = generateId();
      variantIds.push(invalidId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceVariantRepository.create(variantInput(invalidId, productId, storeId, organizationAId, { priceMinorUnits: 100, compareAtPriceMinorUnits: 99 }), tx)), "23514", "ecommerce_variants_compare_at_price_check");

      const equalId = await createVariant(productId, storeId, organizationAId, { priceMinorUnits: 100, compareAtPriceMinorUnits: 100 });
      const greaterId = await createVariant(productId, storeId, organizationAId, { priceMinorUnits: 100, compareAtPriceMinorUnits: 125 });
      expect(await withTenantContext(platformContext(), (tx) => tx.ecommerceVariant.count({ where: { id: { in: [equalId, greaterId] } } }))).toBe(2);
    });

    it("rejects impossible and negative import row counts", async () => {
      const storeId = await createStore(await createEcommerceEngagement());
      const invalidCounts = [
        { totalRowCount: 1, importedRowCount: 1, skippedRowCount: 1 },
        { totalRowCount: -1, importedRowCount: 0, skippedRowCount: 0 },
        { totalRowCount: 1, importedRowCount: -1, skippedRowCount: 0 },
        { totalRowCount: 1, importedRowCount: 0, skippedRowCount: -1 },
      ];
      for (const counts of invalidCounts) {
        const id = generateId();
        importBatchIds.push(id);
        await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceImportBatchRepository.create({ id, organizationId: organizationAId, storeId, importedByUserId: platformUserId, ...counts }, tx)), "23514", "ecommerce_import_batches_row_counts_check");
      }
    });
  });

  describe("defense-in-depth for forged relationships", () => {
    it("proves forced child-table WITH CHECK policies independently require platform tenant ownership", async () => {
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
            AND c.relname IN (
              'ecommerce_products',
              'ecommerce_variants',
              'ecommerce_collections',
              'ecommerce_collection_products',
              'ecommerce_import_batches'
            )
          ORDER BY c.relname
        `,
      );
      expect(policies.map((policy) => policy.table_name)).toEqual([
        "ecommerce_collection_products",
        "ecommerce_collections",
        "ecommerce_import_batches",
        "ecommerce_products",
        "ecommerce_variants",
      ]);
      for (const policy of policies) {
        expect(policy.row_security).toBe(true);
        expect(policy.force_row_security).toBe(true);
        expect(policy.with_check).toContain("organization_id = tenant_current_organization_id()");
        expect(policy.with_check).toContain("tenant_is_platform_context()");
      }
    });

    it("operationally rejects forged parent organizations in every child BEFORE trigger", async () => {
      const engagementId = await createEcommerceEngagement();
      const storeId = await createStore(engagementId);
      const productId = await createProduct(storeId);
      const collectionId = await createCollection(storeId);

      const attempts: Array<[(tx: TenantTransactionClient) => Promise<unknown>, string]> = [
        [(tx) => tx.ecommerceProduct.create({ data: productInput(generateId(), storeId, organizationBId) }), "Ecommerce product organization must match its store organization"],
        [(tx) => tx.ecommerceVariant.create({ data: variantInput(generateId(), productId, storeId, organizationBId) }), "Ecommerce variant organization must match its product organization"],
        [(tx) => tx.ecommerceCollection.create({ data: { id: generateId(), organizationId: organizationBId, storeId, title: "Forged", handle: null, createdByUserId: platformUserId } }), "Ecommerce collection organization must match its store organization"],
        [(tx) => tx.ecommerceCollectionProduct.create({ data: { id: generateId(), organizationId: organizationBId, collectionId, productId, sortOrder: 0 } }), "Ecommerce collection product organization must match its collection organization"],
        [(tx) => tx.ecommerceImportBatch.create({ data: { id: generateId(), organizationId: organizationBId, storeId, importedByUserId: platformUserId, totalRowCount: 0, importedRowCount: 0, skippedRowCount: 0 } }), "Ecommerce import batch organization must match its store organization"],
      ];
      for (const [attempt, message] of attempts) await expectPgError(withTenantContext(platformContext(), attempt), "23514", message);
    });
  });

  describe("variant store denormalization", () => {
    it("rejects a variant whose storeId differs from its parent product store", async () => {
      const engagementId = await createEcommerceEngagement();
      const productStoreId = await createStore(engagementId);
      const forgedStoreId = await createStore(engagementId);
      const productId = await createProduct(productStoreId);
      const variantId = generateId();
      variantIds.push(variantId);
      await expectPgError(withTenantContext(platformContext(), (tx) => ecommerceVariantRepository.create(variantInput(variantId, productId, forgedStoreId), tx)), "23514", "Ecommerce variant store must match its product store");
    });
  });
});
