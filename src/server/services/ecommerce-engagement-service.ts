import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveEcommerceDevScope } from "./ecommerce-shared";
import { ecommerceEngagementRepository } from "@/server/repositories/ecommerce-engagement-repository";
import { ecommerceStoreRepository, type EcommerceStoreUpdateInput } from "@/server/repositories/ecommerce-store-repository";
import { ecommerceProductRepository } from "@/server/repositories/ecommerce-product-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { createProject } from "./project-service";
import { getWebsiteSiteOverview } from "./website-engagement-service";
import { isHttpUrl } from "@/lib/website-dev/url";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { evaluateEcommerceReadiness, type EcommerceReadinessResult } from "@/lib/ecommerce/launch-readiness";
import { audit } from "@/lib/audit/service";
import { PermissionDeniedError } from "@/lib/authorization/errors";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { EcommerceEngagement, EcommerceStore, CustomerService } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * E-Commerce Development engagement/store management (Build 33 —
 * Roadmap Module 27) — the specialist layer attached to exactly one
 * `CustomerService` whose `ServiceDefinition.category = ECOMMERCE`. A
 * FOURTH, SEPARATE specialist domain from SEO OS/Local SEO/Website
 * Development — see docs/architecture/ecommerce-development-os.md for
 * the full architecture writeup. `ecommerce_development.manage` for
 * structural mutations (engagement/store/catalog create/archive);
 * `ecommerce_development.read` for listing/detail.
 */

async function assertEligibleEcommerceCustomerService(customerServiceId: string, organizationId: string, tx: TransactionClient): Promise<CustomerService> {
  const customerService = await customerServiceRepository.findById(customerServiceId, tx);
  if (!customerService || customerService.organizationId !== organizationId) throw new NotFoundError("Customer service");
  // Never trust a client-supplied id — re-verify the category server-side
  // even though the DB trigger will ALSO reject a mismatch on insert (a
  // SEPARATE trigger from SEO OS's/Local SEO's/Website Dev's own — see
  // the migration).
  const definition = await tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { category: true } });
  if (!definition || definition.category !== "ECOMMERCE") {
    throw new ValidationError("This customer service does not use an E-Commerce Development service definition — an E-Commerce Development engagement can only attach to a service whose category is ECOMMERCE.");
  }
  return customerService;
}

/**
 * WDEV-SEC-01-class credential-content screen (Codex Security Engineer,
 * Build 32) — every persisted free-text field in this domain is
 * screened for a credential-shaped substring before it reaches the
 * database, not just fields literally named "password"/"secret".
 * Applied from the start here rather than discovered as a Build 33
 * security-review finding.
 */
function assertFieldsClean(fields: Record<string, string | null | undefined>): void {
  for (const [label, value] of Object.entries(fields)) {
    try {
      assertNoSecretLikeContent(value, label);
    } catch (error) {
      if (error instanceof SuspectedSecretContentError) throw new ValidationError(error.message);
      throw error;
    }
  }
}

// --- Engagement list ------------------------------------------------------

export interface EcommerceEngagementListItem {
  engagement: EcommerceEngagement;
  companyName: string;
  serviceName: string;
  customerServiceStatus: string;
  storeCount: number;
}

/** Every E-Commerce Development engagement, bounded to 200 — same realistic-total assumption every specialist engagement list already documents. */
export async function listEcommerceEngagements(): Promise<EcommerceEngagementListItem[]> {
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    const engagements = await tx.ecommerceEngagement.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
    if (engagements.length === 0) return [];

    const customerServiceIds = engagements.map((e) => e.customerServiceId);
    const customerServices = await tx.customerService.findMany({ where: { id: { in: customerServiceIds } }, select: { id: true, status: true, companyId: true, serviceDefinitionId: true } });
    const customerServiceById = new Map(customerServices.map((cs) => [cs.id, cs]));
    const companyIds = [...new Set(customerServices.map((cs) => cs.companyId))];
    const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
    const [companies, definitions, storeCounts] = await Promise.all([
      tx.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true } }),
      tx.ecommerceStore.groupBy({ by: ["engagementId"], where: { engagementId: { in: engagements.map((e) => e.id) } }, _count: { id: true } }),
    ]);
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
    const definitionNameById = new Map(definitions.map((d) => [d.id, d.name]));
    const storeCountByEngagement = new Map(storeCounts.map((s) => [s.engagementId, s._count.id]));

    return engagements.map((engagement) => {
      const cs = customerServiceById.get(engagement.customerServiceId);
      return {
        engagement,
        companyName: cs ? (companyNameById.get(cs.companyId) ?? "Customer") : "Customer",
        serviceName: cs ? (definitionNameById.get(cs.serviceDefinitionId) ?? "E-Commerce Development") : "E-Commerce Development",
        customerServiceStatus: cs?.status ?? "UNKNOWN",
        storeCount: storeCountByEngagement.get(engagement.id) ?? 0,
      };
    });
  });
}

// --- Engagement -----------------------------------------------------------

const createEngagementSchema = z.object({ customerServiceId: z.string().uuid() });

/** Idempotent — a repeat call for the same `customerServiceId` returns the existing engagement, same pattern every specialist engagement creation function already establishes. */
export async function createEcommerceEngagement(rawInput: unknown): Promise<EcommerceEngagement> {
  const input = parseOrThrow(createEngagementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const { engagement, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await ecommerceEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx);
    if (existing) return { engagement: existing, wasCreated: false };

    await assertEligibleEcommerceCustomerService(input.customerServiceId, organizationId, tx);
    const created = await ecommerceEngagementRepository.create({ id: generateId(), organizationId, customerServiceId: input.customerServiceId, createdByUserId: context.user!.id }, tx);
    return { engagement: created, wasCreated: true };
  });

  if (wasCreated) {
    await audit
      .recordSuccess({ action: "ecommerce.engagement_created", organizationId, resourceType: "ecommerce_engagement", resourceId: engagement.id, resourceName: "E-Commerce Development engagement", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record ecommerce.engagement_created", error));
  }
  return engagement;
}

const engagementIdSchema = z.object({ engagementId: z.string().uuid() });

export async function getEcommerceEngagement(rawInput: unknown): Promise<EcommerceEngagement> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  const engagement = await withTenantContext(tenantScope, (tx) => ecommerceEngagementRepository.findById(input.engagementId, tx));
  if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("E-Commerce Development engagement");
  return engagement;
}

const customerServiceIdSchema = z.object({ customerServiceId: z.string().uuid() });

/** `null` (never throws) when no engagement exists yet — callers (the CustomerService detail page's "Set up E-Commerce workspace" affordance) branch on this. */
export async function getEcommerceEngagementByCustomerService(rawInput: unknown): Promise<EcommerceEngagement | null> {
  const input = parseOrThrow(customerServiceIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");
  const engagement = await withTenantContext(tenantScope, (tx) => ecommerceEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx));
  if (!engagement || engagement.organizationId !== organizationId) return null;
  return engagement;
}

export interface EcommerceStoreSummary {
  store: EcommerceStore;
  productCount: number;
  websiteSiteName: string | null;
}

export interface EcommerceEngagementDetail {
  engagement: EcommerceEngagement;
  customerServiceId: string;
  companyName: string;
  serviceName: string;
  linkedProjectTitle: string | null;
  stores: EcommerceStoreSummary[];
}

/** The engagement workspace's own enriched read — bounded batch, never one query per store. Resolves `ecommerce_development.read` exactly ONCE (applying Build 31/32's own PERF-03 lesson from the start). */
export async function getEcommerceEngagementDetail(rawInput: unknown): Promise<EcommerceEngagementDetail> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");

  return withTenantContext(tenantScope, async (tx) => {
    const engagement = await ecommerceEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("E-Commerce Development engagement");

    const [customerService, stores, linkedProject] = await Promise.all([
      tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, serviceDefinitionId: true } }),
      ecommerceStoreRepository.listForEngagement(engagement.id, tx),
      engagement.projectId ? tx.project.findUnique({ where: { id: engagement.projectId }, select: { title: true } }) : Promise.resolve(null),
    ]);
    const [company, definition] = await Promise.all([
      customerService ? tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : Promise.resolve(null),
      customerService ? tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    const storeIds = stores.map((s) => s.id);
    const websiteSiteIds = stores.map((s) => s.websiteSiteId).filter((id): id is string => id !== null);
    const [productCountsByStore, websiteSites] = await Promise.all([
      ecommerceProductRepository.countsForStores(storeIds, tx),
      websiteSiteIds.length > 0 ? tx.websiteSite.findMany({ where: { id: { in: websiteSiteIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const websiteSiteNameById = new Map(websiteSites.map((s) => [s.id, s.name]));

    const storeSummaries: EcommerceStoreSummary[] = stores.map((store) => ({
      store,
      productCount: productCountsByStore.get(store.id)?.productCount ?? 0,
      websiteSiteName: store.websiteSiteId ? (websiteSiteNameById.get(store.websiteSiteId) ?? null) : null,
    }));

    return {
      engagement,
      customerServiceId: engagement.customerServiceId,
      companyName: company?.name ?? "Customer",
      serviceName: definition?.name ?? "E-Commerce Development",
      linkedProjectTitle: linkedProject?.title ?? null,
      stores: storeSummaries,
    };
  });
}

// --- Project linking ---------------------------------------------------

const linkNewProjectSchema = z.object({
  engagementId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
});

/** Creates a NEW Project via Project Management's own public service (never a direct `Project` insert), then links it to the engagement. `customerOrganizationId`/`companyId` are read off the SAME `CustomerService` the engagement is attached to — guaranteeing consistency by construction. */
export async function createAndLinkEcommerceProject(rawInput: unknown): Promise<EcommerceEngagement> {
  const input = parseOrThrow(linkNewProjectSchema, rawInput);
  assertFieldsClean({ "Project title": input.title, "Project description": input.description ?? null });
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const { engagement, customerServiceId, customerOrganizationId, companyId } = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await ecommerceEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("E-Commerce Development engagement");
    if (engagement.projectId) throw new ConflictError("This engagement is already linked to a project.");
    const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { customerOrganizationId: true, companyId: true } });
    if (!customerService) throw new NotFoundError("Customer service");
    return { engagement, customerServiceId: engagement.customerServiceId, customerOrganizationId: customerService.customerOrganizationId, companyId: customerService.companyId };
  });

  // A genuine cross-service call — Project Management independently
  // re-authorizes and re-validates consistency itself; never a direct
  // `Project` insert here.
  const project = await createProject({ customerOrganizationId, companyId, title: input.title, description: input.description ?? null, customerServiceId });

  const linked = await withTenantContext(tenantScope, async (tx) => {
    const result = await tx.ecommerceEngagement.updateMany({ where: { id: engagement.id, projectId: null }, data: { projectId: project.id } });
    if (result.count === 0) throw new ConflictError("This engagement was just linked to a project by someone else. Reload and try again.");
    return ecommerceEngagementRepository.findById(engagement.id, tx);
  });
  if (!linked) throw new NotFoundError("E-Commerce Development engagement");

  await audit
    .recordSuccess({ action: "ecommerce.project_linked", organizationId, resourceType: "ecommerce_engagement", resourceId: linked.id, resourceName: input.title, metadata: { projectId: project.id }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.project_linked", error));
  return linked;
}

const linkExistingProjectSchema = z.object({ engagementId: z.string().uuid(), projectId: z.string().uuid() });

/** Links an EXISTING project — structurally verified to belong to the SAME platform organization and the SAME customer organization as the engagement before linking. */
export async function linkExistingEcommerceProject(rawInput: unknown): Promise<EcommerceEngagement> {
  const input = parseOrThrow(linkExistingProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const engagement = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await ecommerceEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("E-Commerce Development engagement");
    if (engagement.projectId) throw new ConflictError("This engagement is already linked to a project.");

    const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { customerOrganizationId: true } });
    if (!customerService) throw new NotFoundError("Customer service");

    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { organizationId: true, customerOrganizationId: true } });
    if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");
    if (project.customerOrganizationId !== customerService.customerOrganizationId) {
      throw new ValidationError("This project belongs to a different customer organization than this E-Commerce Development engagement.");
    }

    const result = await tx.ecommerceEngagement.updateMany({ where: { id: engagement.id, projectId: null }, data: { projectId: input.projectId } });
    if (result.count === 0) throw new ConflictError("This engagement was just linked to a project by someone else. Reload and try again.");
    return ecommerceEngagementRepository.findById(engagement.id, tx);
  });
  if (!engagement) throw new NotFoundError("E-Commerce Development engagement");

  await audit
    .recordSuccess({ action: "ecommerce.project_linked", organizationId, resourceType: "ecommerce_engagement", resourceId: engagement.id, resourceName: "E-Commerce Development engagement", metadata: { projectId: input.projectId }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.project_linked", error));
  return engagement;
}

// --- Stores -------------------------------------------------------------

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase());

const createStoreSchema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  platform: z.enum(["SHOPIFY", "WOOCOMMERCE", "CUSTOM", "OTHER"]).default("OTHER"),
  externalStoreIdentifier: z.string().trim().max(200).nullable().optional(),
  websiteSiteId: z.string().uuid().nullable().optional(),
  storeUrl: z.string().trim().max(2048).nullable().optional(),
  currency: currencySchema.nullable().optional(),
});

export async function createEcommerceStore(rawInput: unknown): Promise<EcommerceStore> {
  const input = parseOrThrow(createStoreSchema, rawInput);
  // Codex Security Engineer finding ECOM-SEC-01 — every persisted
  // free-text field is screened, not just `name`.
  assertFieldsClean({ "Store name": input.name, "External store identifier": input.externalStoreIdentifier ?? null, "Store URL": input.storeUrl ?? null });
  if (input.storeUrl && !isHttpUrl(input.storeUrl)) throw new ValidationError("storeUrl must use http:// or https://");
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const store = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await ecommerceEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("E-Commerce Development engagement");

    if (input.externalStoreIdentifier) {
      const existing = await ecommerceStoreRepository.findByExternalIdentifier(input.engagementId, input.externalStoreIdentifier, tx);
      if (existing) throw new ConflictError(`"${input.externalStoreIdentifier}" is already tracked as a store identifier on this engagement.`);
    }

    if (input.websiteSiteId) {
      await assertWebsiteSiteLinkable(input.websiteSiteId, engagement.customerServiceId, organizationId, tx);
    }

    return ecommerceStoreRepository.create(
      {
        id: generateId(),
        organizationId,
        engagementId: input.engagementId,
        name: input.name,
        platform: input.platform,
        externalStoreIdentifier: input.externalStoreIdentifier ?? null,
        websiteSiteId: input.websiteSiteId ?? null,
        storeUrl: input.storeUrl ?? null,
        currency: input.currency ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "ecommerce.store_created", organizationId, resourceType: "ecommerce_store", resourceId: store.id, resourceName: store.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.store_created", error));
  return store;
}

/**
 * Structural cross-customer defense-in-depth (app layer) alongside the
 * DB trigger's own equivalent check: a `WebsiteSite` may only be linked
 * to a store whose OWN engagement resolves to the SAME customer
 * organization and company. Also rejects a site already claimed by
 * another store (the DB's own real UNIQUE constraint on `websiteSiteId`
 * would catch this too, but a friendly pre-check message is better UX,
 * same discipline as every other dedup check in this codebase).
 */
async function assertWebsiteSiteLinkable(websiteSiteId: string, ecommerceCustomerServiceId: string, organizationId: string, tx: TransactionClient): Promise<void> {
  const site = await tx.websiteSite.findUnique({ where: { id: websiteSiteId }, select: { id: true, organizationId: true, engagementId: true } });
  if (!site || site.organizationId !== organizationId) throw new NotFoundError("Website site");

  const alreadyClaimed = await ecommerceStoreRepository.findByWebsiteSiteId(websiteSiteId, tx);
  if (alreadyClaimed) throw new ConflictError("This website site is already linked to another store.");

  const [ecommerceCustomerService, websiteEngagement] = await Promise.all([
    tx.customerService.findUnique({ where: { id: ecommerceCustomerServiceId }, select: { customerOrganizationId: true, companyId: true } }),
    tx.websiteEngagement.findUnique({ where: { id: site.engagementId }, select: { customerServiceId: true } }),
  ]);
  if (!ecommerceCustomerService) throw new NotFoundError("Customer service");
  if (!websiteEngagement) throw new NotFoundError("Website Development engagement");

  const websiteCustomerService = await tx.customerService.findUnique({ where: { id: websiteEngagement.customerServiceId }, select: { customerOrganizationId: true, companyId: true } });
  if (!websiteCustomerService) throw new NotFoundError("Customer service");

  if (websiteCustomerService.customerOrganizationId !== ecommerceCustomerService.customerOrganizationId || websiteCustomerService.companyId !== ecommerceCustomerService.companyId) {
    throw new ValidationError("This website site belongs to a different customer organization/company than this E-Commerce Development engagement.");
  }
}

const storeIdSchema = z.object({ storeId: z.string().uuid() });

export async function loadEcommerceStoreChecked(storeId: string, organizationId: string, tx: TransactionClient): Promise<EcommerceStore> {
  const store = await ecommerceStoreRepository.findById(storeId, tx);
  if (!store || store.organizationId !== organizationId) throw new NotFoundError("E-Commerce store");
  return store;
}

const updateStoreSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  platform: z.enum(["SHOPIFY", "WOOCOMMERCE", "CUSTOM", "OTHER"]).optional(),
  externalStoreIdentifier: z.string().trim().max(200).nullable().optional(),
  storeUrl: z.string().trim().max(2048).nullable().optional(),
  currency: currencySchema.nullable().optional(),
  launchTargetDate: z.coerce.date().nullable().optional(),
});

export async function updateEcommerceStore(rawInput: unknown): Promise<EcommerceStore> {
  const input = parseOrThrow(updateStoreSchema, rawInput);
  // Codex Security Engineer finding ECOM-SEC-01 — mirrors createEcommerceStore()'s own full field coverage.
  assertFieldsClean({ "Store name": input.name ?? null, "External store identifier": input.externalStoreIdentifier ?? null, "Store URL": input.storeUrl ?? null });
  if (input.storeUrl && !isHttpUrl(input.storeUrl)) throw new ValidationError("storeUrl must use http:// or https://");
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const { storeId, ...rest } = input;
  const store = await withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(storeId, organizationId, tx);
    return ecommerceStoreRepository.update(storeId, rest as EcommerceStoreUpdateInput, tx);
  });

  await audit
    .recordSuccess({ action: "ecommerce.store_created", organizationId, resourceType: "ecommerce_store", resourceId: store.id, resourceName: store.name, metadata: { updated: true }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.store_created", error));
  return store;
}

const updateConfigurationSchema = z.object({
  storeId: z.string().uuid(),
  checkoutConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  paymentConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  paymentProviderLabel: z.string().trim().max(120).nullable().optional(),
  shippingConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  taxConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  discountsConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  inventoryConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
});

/** Records manually-observed commerce configuration facts only — never a live provider-connection check (no such integration exists in this build). `paymentProviderLabel` is a free-text label (e.g. "Stripe", "PayPal"), screened for embedded credentials, NEVER a credential itself. */
export async function updateEcommerceStoreConfiguration(rawInput: unknown): Promise<EcommerceStore> {
  const input = parseOrThrow(updateConfigurationSchema, rawInput);
  assertFieldsClean({ "Payment provider label": input.paymentProviderLabel ?? null });
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");

  const { storeId, ...rest } = input;
  const store = await withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(storeId, organizationId, tx);
    return ecommerceStoreRepository.update(storeId, rest as EcommerceStoreUpdateInput, tx);
  });

  await audit
    .recordSuccess({ action: "ecommerce.store_configuration_updated", organizationId, resourceType: "ecommerce_store", resourceId: store.id, resourceName: store.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.store_configuration_updated", error));
  return store;
}

export async function archiveEcommerceStore(rawInput: unknown): Promise<EcommerceStore> {
  const input = parseOrThrow(storeIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");
  const store = await withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    const updated = await ecommerceStoreRepository.archive(input.storeId, tx);
    if (!updated) throw new ConflictError("This store was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "ecommerce.store_archived", organizationId, resourceType: "ecommerce_store", resourceId: store.id, resourceName: store.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.store_archived", error));
  return store;
}

export async function reactivateEcommerceStore(rawInput: unknown): Promise<EcommerceStore> {
  const input = parseOrThrow(storeIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.manage");
  const store = await withTenantContext(tenantScope, async (tx) => {
    await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    // Restores to IN_DEVELOPMENT, never silently back to LIVE — a real
    // launch must be re-recorded via `recordEcommerceStoreLaunch()`.
    const updated = await ecommerceStoreRepository.reactivate(input.storeId, "IN_DEVELOPMENT", tx);
    if (!updated) throw new ConflictError("This store was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "ecommerce.store_reactivated", organizationId, resourceType: "ecommerce_store", resourceId: store.id, resourceName: store.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ecommerce.store_reactivated", error));
  return store;
}

// --- Overview / launch readiness ---------------------------------------------------

export interface EcommerceStoreOverview {
  store: EcommerceStore;
  engagementId: string;
  productCount: number;
  requiredProductCount: number;
  completedRequiredProductCount: number;
  requiredQaCount: number;
  passedRequiredQaCount: number;
  readiness: EcommerceReadinessResult;
  /** `true` only when this store has a linked `WebsiteSite` AND the acting caller lacks `website_development.read` — the readiness display should honestly say "unavailable," never silently treat it as no-website-linked. */
  websiteReadinessUnavailable: boolean;
}

/**
 * The store workspace's own enriched read. QA is reused DIRECTLY from
 * Project QA (`projectQaCheckRepository.listForProject()`) — E-Commerce
 * OS never builds a second QA engine. Website readiness (when this
 * store has a linked `WebsiteSite`) is reused DIRECTLY from Website
 * Development's own public `getWebsiteSiteOverview()` — never
 * re-derived. A caller lacking `website_development.read` still sees
 * this read-only overview (the website signal degrades honestly to
 * "unavailable" — see `websiteReadinessUnavailable`); contrast with
 * `recordEcommerceStoreLaunch()`, which deliberately fails closed
 * instead (an irreversible action must not silently bypass a website
 * readiness check the caller simply couldn't see).
 */
export async function getEcommerceStoreOverview(rawInput: unknown): Promise<EcommerceStoreOverview> {
  const input = parseOrThrow(storeIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.read");

  const { store, productCounts, requiredQa } = await withTenantContext(tenantScope, async (tx) => {
    const store = await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    const engagement = await ecommerceEngagementRepository.findById(store.engagementId, tx);
    if (!engagement) throw new NotFoundError("E-Commerce Development engagement");

    const [productCounts, qaChecks] = await Promise.all([
      ecommerceProductRepository.countsForStore(input.storeId, tx),
      engagement.projectId ? projectQaCheckRepository.listForProject(engagement.projectId, tx) : Promise.resolve([]),
    ]);
    const requiredQa = qaChecks.filter((q) => q.required);
    return { store, productCounts, requiredQa };
  });

  const passedRequiredQa = requiredQa.filter((q) => q.status === "PASSED" || q.status === "WAIVED");

  let linkedWebsiteReadiness: "READY" | "NOT_READY" | null = null;
  let websiteReadinessUnavailable = false;
  if (store.websiteSiteId) {
    try {
      const siteOverview = await getWebsiteSiteOverview({ siteId: store.websiteSiteId });
      linkedWebsiteReadiness = siteOverview.readiness.status === "NOT_MEASURABLE" ? null : siteOverview.readiness.status;
    } catch (error) {
      // Read-only enrichment: a caller who holds ecommerce_development.
      // read but not website_development.read still sees this store's
      // own overview — the linked site's readiness is honestly reported
      // as unavailable (never fabricated as READY) rather than blocking
      // the whole page. Any OTHER error still propagates. Contrast with
      // `recordEcommerceStoreLaunch()`, which deliberately does NOT
      // catch this — an irreversible launch action fails closed instead.
      if (!(error instanceof PermissionDeniedError)) throw error;
      websiteReadinessUnavailable = true;
    }
  }

  const readiness = evaluateEcommerceReadiness({
    storeExists: true,
    checkoutConfigured: store.checkoutConfigured === "YES",
    paymentConfigured: store.paymentConfigured === "YES",
    requiredProductCount: productCounts.requiredProductCount,
    completedRequiredProductCount: productCounts.completedRequiredProductCount,
    requiredQaCount: requiredQa.length,
    passedRequiredQaCount: passedRequiredQa.length,
    linkedWebsiteReadiness,
  });

  return {
    store,
    engagementId: store.engagementId,
    productCount: productCounts.productCount,
    requiredProductCount: productCounts.requiredProductCount,
    completedRequiredProductCount: productCounts.completedRequiredProductCount,
    requiredQaCount: requiredQa.length,
    passedRequiredQaCount: passedRequiredQa.length,
    readiness,
    websiteReadinessUnavailable,
  };
}
