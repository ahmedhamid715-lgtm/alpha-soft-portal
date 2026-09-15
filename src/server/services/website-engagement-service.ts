import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveWebsiteDevScope } from "./website-shared";
import { websiteEngagementRepository } from "@/server/repositories/website-engagement-repository";
import { websiteSiteRepository, type WebsiteSiteUpdateInput } from "@/server/repositories/website-site-repository";
import { websiteEnvironmentRepository } from "@/server/repositories/website-environment-repository";
import { websitePageRepository, type WebsitePageListFilters } from "@/server/repositories/website-page-repository";
import { websiteDeploymentRepository } from "@/server/repositories/website-deployment-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { createProject } from "./project-service";
import { normalizeWebsiteUrl, InvalidWebsiteUrlError, isHttpUrl } from "@/lib/website-dev/url";
import { normalizeWebsitePagePath, InvalidWebsitePagePathError } from "@/lib/website-dev/page-path";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/website-dev/secret-guard";
import { canTransitionWebsitePage } from "@/lib/website-dev/page-lifecycle";
import { evaluateLaunchReadiness, type LaunchReadinessResult } from "@/lib/website-dev/launch-readiness";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { WebsiteEngagement, WebsiteSite, WebsiteEnvironment, WebsitePage, CustomerService, WebsitePageStatus } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginatedResult, OffsetPaginationParams } from "@/lib/platform/pagination";

/**
 * Website Development engagement/site/environment/page management
 * (Build 32 — Roadmap Module 26) — the specialist layer attached to
 * exactly one `CustomerService` whose `ServiceDefinition.category =
 * WEB_DEVELOPMENT`. A THIRD, SEPARATE specialist domain from SEO OS and
 * Local SEO — see docs/architecture/website-development-os.md for the
 * full architecture writeup. `website_development.manage` for
 * structural mutations (engagement/site/environment/page create/
 * archive); `website_development.read` for listing/detail.
 */

async function assertEligibleWebsiteCustomerService(customerServiceId: string, organizationId: string, tx: TransactionClient): Promise<CustomerService> {
  const customerService = await customerServiceRepository.findById(customerServiceId, tx);
  if (!customerService || customerService.organizationId !== organizationId) throw new NotFoundError("Customer service");
  // Never trust a client-supplied id — re-verify the category server-side
  // even though the DB trigger will ALSO reject a mismatch on insert (a
  // SEPARATE trigger from SEO OS's/Local SEO's own — see the migration).
  const definition = await tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { category: true } });
  if (!definition || definition.category !== "WEB_DEVELOPMENT") {
    throw new ValidationError("This customer service does not use a Website Development service definition — a Website Development engagement can only attach to a service whose category is WEB_DEVELOPMENT.");
  }
  return customerService;
}

/**
 * WDEV-SEC-01 (Codex Security Engineer, Build 32) — every persisted
 * free-text field in this domain is screened for a credential-shaped
 * substring before it reaches the database, not just fields literally
 * named "password"/"secret". Converts the guard's own error type into
 * the domain's ordinary `ValidationError` so callers get one consistent
 * 400-shaped failure.
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

export interface WebsiteEngagementListItem {
  engagement: WebsiteEngagement;
  companyName: string;
  serviceName: string;
  customerServiceStatus: string;
  siteCount: number;
}

/** Every Website Development engagement, bounded to 200 — same realistic-total assumption every specialist engagement list already documents. */
export async function listWebsiteEngagements(): Promise<WebsiteEngagementListItem[]> {
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    const engagements = await tx.websiteEngagement.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
    if (engagements.length === 0) return [];

    const customerServiceIds = engagements.map((e) => e.customerServiceId);
    const customerServices = await tx.customerService.findMany({ where: { id: { in: customerServiceIds } }, select: { id: true, status: true, companyId: true, serviceDefinitionId: true } });
    const customerServiceById = new Map(customerServices.map((cs) => [cs.id, cs]));
    const companyIds = [...new Set(customerServices.map((cs) => cs.companyId))];
    const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
    const [companies, definitions, siteCounts] = await Promise.all([
      tx.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true } }),
      tx.websiteSite.groupBy({ by: ["engagementId"], where: { engagementId: { in: engagements.map((e) => e.id) } }, _count: { id: true } }),
    ]);
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
    const definitionNameById = new Map(definitions.map((d) => [d.id, d.name]));
    const siteCountByEngagement = new Map(siteCounts.map((s) => [s.engagementId, s._count.id]));

    return engagements.map((engagement) => {
      const cs = customerServiceById.get(engagement.customerServiceId);
      return {
        engagement,
        companyName: cs ? (companyNameById.get(cs.companyId) ?? "Customer") : "Customer",
        serviceName: cs ? (definitionNameById.get(cs.serviceDefinitionId) ?? "Website Development") : "Website Development",
        customerServiceStatus: cs?.status ?? "UNKNOWN",
        siteCount: siteCountByEngagement.get(engagement.id) ?? 0,
      };
    });
  });
}

// --- Engagement -----------------------------------------------------------

const createEngagementSchema = z.object({ customerServiceId: z.string().uuid() });

/** Idempotent — a repeat call for the same `customerServiceId` returns the existing engagement, same pattern every specialist engagement creation function already establishes. */
export async function createWebsiteEngagement(rawInput: unknown): Promise<WebsiteEngagement> {
  const input = parseOrThrow(createEngagementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  const { engagement, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await websiteEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx);
    if (existing) return { engagement: existing, wasCreated: false };

    await assertEligibleWebsiteCustomerService(input.customerServiceId, organizationId, tx);
    const created = await websiteEngagementRepository.create({ id: generateId(), organizationId, customerServiceId: input.customerServiceId, createdByUserId: context.user!.id }, tx);
    return { engagement: created, wasCreated: true };
  });

  if (wasCreated) {
    await audit
      .recordSuccess({ action: "websitedev.engagement_created", organizationId, resourceType: "website_engagement", resourceId: engagement.id, resourceName: "Website Development engagement", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record websitedev.engagement_created", error));
  }
  return engagement;
}

const engagementIdSchema = z.object({ engagementId: z.string().uuid() });

export async function getWebsiteEngagement(rawInput: unknown): Promise<WebsiteEngagement> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  const engagement = await withTenantContext(tenantScope, (tx) => websiteEngagementRepository.findById(input.engagementId, tx));
  if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Website Development engagement");
  return engagement;
}

const customerServiceIdSchema = z.object({ customerServiceId: z.string().uuid() });

/** `null` (never throws) when no engagement exists yet — callers (the CustomerService detail page's "Set up Website workspace" affordance) branch on this. */
export async function getWebsiteEngagementByCustomerService(rawInput: unknown): Promise<WebsiteEngagement | null> {
  const input = parseOrThrow(customerServiceIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  const engagement = await withTenantContext(tenantScope, (tx) => websiteEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx));
  if (!engagement || engagement.organizationId !== organizationId) return null;
  return engagement;
}

export interface WebsiteSiteSummary {
  site: WebsiteSite;
  pageCount: number;
  environmentCount: number;
  hasProductionEnvironment: boolean;
  latestDeploymentAt: Date | null;
}

export interface WebsiteEngagementDetail {
  engagement: WebsiteEngagement;
  customerServiceId: string;
  companyName: string;
  serviceName: string;
  linkedProjectTitle: string | null;
  sites: WebsiteSiteSummary[];
}

/** The engagement workspace's own enriched read — bounded batch, never one query per site. Resolves `website_development.read` exactly ONCE (applying Build 31's own Codex-found PERF-03 lesson from the start). */
export async function getWebsiteEngagementDetail(rawInput: unknown): Promise<WebsiteEngagementDetail> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");

  return withTenantContext(tenantScope, async (tx) => {
    const engagement = await websiteEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Website Development engagement");

    const [customerService, sites, linkedProject] = await Promise.all([
      tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, serviceDefinitionId: true } }),
      websiteSiteRepository.listForEngagement(engagement.id, tx),
      engagement.projectId ? tx.project.findUnique({ where: { id: engagement.projectId }, select: { title: true } }) : Promise.resolve(null),
    ]);
    const [company, definition] = await Promise.all([
      customerService ? tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : Promise.resolve(null),
      customerService ? tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    const siteIds = sites.map((s) => s.id);
    const [pageCountsBySite, environments, latestDeployments] = await Promise.all([
      websitePageRepository.countsForSites(siteIds, tx),
      websiteEnvironmentRepository.listForSites(siteIds, tx),
      websiteDeploymentRepository.listLatestForSites(siteIds, tx),
    ]);
    const environmentsBySite = new Map<string, typeof environments>();
    for (const e of environments) environmentsBySite.set(e.siteId, [...(environmentsBySite.get(e.siteId) ?? []), e]);
    const latestDeploymentBySite = new Map(latestDeployments.map((d) => [d.siteId, d.deployment]));

    const siteSummaries: WebsiteSiteSummary[] = sites.map((site) => {
      const siteEnvironments = environmentsBySite.get(site.id) ?? [];
      return {
        site,
        pageCount: pageCountsBySite.get(site.id)?.pageCount ?? 0,
        environmentCount: siteEnvironments.length,
        hasProductionEnvironment: siteEnvironments.some((e) => e.type === "PRODUCTION"),
        latestDeploymentAt: latestDeploymentBySite.get(site.id)?.deployedAt ?? null,
      };
    });

    return {
      engagement,
      customerServiceId: engagement.customerServiceId,
      companyName: company?.name ?? "Customer",
      serviceName: definition?.name ?? "Website Development",
      linkedProjectTitle: linkedProject?.title ?? null,
      sites: siteSummaries,
    };
  });
}

// --- Project linking ---------------------------------------------------

const linkNewProjectSchema = z.object({
  engagementId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
});

/** Creates a NEW Project via Project Management's own public service (never a direct `Project` insert), then links it to the engagement. `customerOrganizationId`/`companyId` are read off the SAME `CustomerService` the engagement is attached to — guaranteeing consistency by construction, never separately supplied by the caller. */
export async function createAndLinkWebsiteProject(rawInput: unknown): Promise<WebsiteEngagement> {
  const input = parseOrThrow(linkNewProjectSchema, rawInput);
  assertFieldsClean({ "Project title": input.title, "Project description": input.description ?? null });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  const { engagement, customerServiceId, customerOrganizationId, companyId } = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await websiteEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Website Development engagement");
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
    // CAS-guarded: only link if still unlinked — a lost race here means
    // someone else linked a project first; the just-created project is
    // simply left as a real, valid, standalone project (never silently
    // deleted — Project Management owns its own lifecycle).
    const result = await tx.websiteEngagement.updateMany({ where: { id: engagement.id, projectId: null }, data: { projectId: project.id } });
    if (result.count === 0) throw new ConflictError("This engagement was just linked to a project by someone else. Reload and try again.");
    return websiteEngagementRepository.findById(engagement.id, tx);
  });
  if (!linked) throw new NotFoundError("Website Development engagement");

  await audit
    .recordSuccess({ action: "websitedev.project_linked", organizationId, resourceType: "website_engagement", resourceId: linked.id, resourceName: input.title, metadata: { projectId: project.id }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.project_linked", error));
  return linked;
}

const linkExistingProjectSchema = z.object({ engagementId: z.string().uuid(), projectId: z.string().uuid() });

/** Links an EXISTING project — structurally verified to belong to the SAME platform organization and the SAME customer organization as the engagement before linking (never relies only on the caller's own form options). */
export async function linkExistingWebsiteProject(rawInput: unknown): Promise<WebsiteEngagement> {
  const input = parseOrThrow(linkExistingProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  const engagement = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await websiteEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Website Development engagement");
    if (engagement.projectId) throw new ConflictError("This engagement is already linked to a project.");

    const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { customerOrganizationId: true } });
    if (!customerService) throw new NotFoundError("Customer service");

    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { organizationId: true, customerOrganizationId: true } });
    if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");
    if (project.customerOrganizationId !== customerService.customerOrganizationId) {
      throw new ValidationError("This project belongs to a different customer organization than this Website Development engagement.");
    }

    const result = await tx.websiteEngagement.updateMany({ where: { id: engagement.id, projectId: null }, data: { projectId: input.projectId } });
    if (result.count === 0) throw new ConflictError("This engagement was just linked to a project by someone else. Reload and try again.");
    return websiteEngagementRepository.findById(engagement.id, tx);
  });
  if (!engagement) throw new NotFoundError("Website Development engagement");

  await audit
    .recordSuccess({ action: "websitedev.project_linked", organizationId, resourceType: "website_engagement", resourceId: engagement.id, resourceName: "Website Development engagement", metadata: { projectId: input.projectId }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.project_linked", error));
  return engagement;
}

// --- Sites -------------------------------------------------------------

const createSiteSchema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  primaryUrl: z.string().trim().max(2048).nullable().optional(),
  siteType: z.enum(["STANDARD", "ECOMMERCE", "OTHER"]).default("STANDARD"),
  platform: z.enum(["WORDPRESS", "SHOPIFY", "WEBFLOW", "CUSTOM_NEXTJS", "OTHER"]).default("OTHER"),
  technologyNotes: z.string().trim().max(2000).nullable().optional(),
  repositoryUrl: z.string().trim().max(2048).nullable().optional(),
});

export async function createWebsiteSite(rawInput: unknown): Promise<WebsiteSite> {
  const input = parseOrThrow(createSiteSchema, rawInput);
  assertFieldsClean({ "Site name": input.name, "Technology notes": input.technologyNotes ?? null, "Repository URL": input.repositoryUrl ?? null });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  let normalizedPrimaryOrigin: string | null = null;
  if (input.primaryUrl) {
    try {
      normalizedPrimaryOrigin = normalizeWebsiteUrl(input.primaryUrl).normalizedOrigin;
    } catch (error) {
      if (error instanceof InvalidWebsiteUrlError) throw new ValidationError(error.message);
      throw error;
    }
  }
  if (input.repositoryUrl && !isHttpUrl(input.repositoryUrl)) throw new ValidationError("repositoryUrl must use http:// or https://");

  const site = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await websiteEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Website Development engagement");

    if (normalizedPrimaryOrigin) {
      const existing = await websiteSiteRepository.findByNormalizedOrigin(input.engagementId, normalizedPrimaryOrigin, tx);
      if (existing) throw new ConflictError(`${normalizedPrimaryOrigin} is already tracked as a site on this engagement.`);
    }

    return websiteSiteRepository.create(
      {
        id: generateId(),
        organizationId,
        engagementId: input.engagementId,
        name: input.name,
        primaryUrl: input.primaryUrl ?? null,
        normalizedPrimaryOrigin,
        siteType: input.siteType,
        platform: input.platform,
        technologyNotes: input.technologyNotes ?? null,
        repositoryUrl: input.repositoryUrl ?? null,
        analyticsConfigured: "UNKNOWN",
        tagManagerConfigured: "UNKNOWN",
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "websitedev.site_created", organizationId, resourceType: "website_site", resourceId: site.id, resourceName: site.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.site_created", error));
  return site;
}

const siteIdSchema = z.object({ siteId: z.string().uuid() });

export async function loadWebsiteSiteChecked(siteId: string, organizationId: string, tx: TransactionClient): Promise<WebsiteSite> {
  const site = await websiteSiteRepository.findById(siteId, tx);
  if (!site || site.organizationId !== organizationId) throw new NotFoundError("Website site");
  return site;
}

const updateSiteSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  primaryUrl: z.string().trim().max(2048).nullable().optional(),
  siteType: z.enum(["STANDARD", "ECOMMERCE", "OTHER"]).optional(),
  platform: z.enum(["WORDPRESS", "SHOPIFY", "WEBFLOW", "CUSTOM_NEXTJS", "OTHER"]).optional(),
  technologyNotes: z.string().trim().max(2000).nullable().optional(),
  repositoryUrl: z.string().trim().max(2048).nullable().optional(),
  analyticsConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  tagManagerConfigured: z.enum(["YES", "NO", "UNKNOWN"]).optional(),
  launchTargetDate: z.coerce.date().nullable().optional(),
});

export async function updateWebsiteSite(rawInput: unknown): Promise<WebsiteSite> {
  const input = parseOrThrow(updateSiteSchema, rawInput);
  assertFieldsClean({ "Site name": input.name ?? null, "Technology notes": input.technologyNotes ?? null, "Repository URL": input.repositoryUrl ?? null });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  let normalizedPrimaryOrigin: string | null | undefined;
  if (input.primaryUrl !== undefined) {
    if (input.primaryUrl === null) {
      normalizedPrimaryOrigin = null;
    } else {
      try {
        normalizedPrimaryOrigin = normalizeWebsiteUrl(input.primaryUrl).normalizedOrigin;
      } catch (error) {
        if (error instanceof InvalidWebsiteUrlError) throw new ValidationError(error.message);
        throw error;
      }
    }
  }
  if (input.repositoryUrl && !isHttpUrl(input.repositoryUrl)) throw new ValidationError("repositoryUrl must use http:// or https://");

  const { siteId, ...rest } = input;
  const site = await withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(siteId, organizationId, tx);
    const data: WebsiteSiteUpdateInput = { ...rest, ...(normalizedPrimaryOrigin !== undefined ? { normalizedPrimaryOrigin } : {}) };
    return websiteSiteRepository.update(siteId, data, tx);
  });

  await audit
    .recordSuccess({ action: "websitedev.site_created", organizationId, resourceType: "website_site", resourceId: site.id, resourceName: site.name, metadata: { updated: true }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.site_created", error));
  return site;
}

export async function archiveWebsiteSite(rawInput: unknown): Promise<WebsiteSite> {
  const input = parseOrThrow(siteIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");
  const site = await withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    const updated = await websiteSiteRepository.archive(input.siteId, tx);
    if (!updated) throw new ConflictError("This site was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "websitedev.site_archived", organizationId, resourceType: "website_site", resourceId: site.id, resourceName: site.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.site_archived", error));
  return site;
}

export async function reactivateWebsiteSite(rawInput: unknown): Promise<WebsiteSite> {
  const input = parseOrThrow(siteIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");
  const site = await withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    // Restores to IN_DEVELOPMENT, never silently back to LAUNCHED — a
    // real launch must be re-recorded via `recordWebsiteLaunch()` if the
    // site is genuinely still live; archiving never implicitly un-does
    // that fact either way, but this keeps the restored status honest
    // rather than assuming.
    const updated = await websiteSiteRepository.reactivate(input.siteId, "IN_DEVELOPMENT", tx);
    if (!updated) throw new ConflictError("This site was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "websitedev.site_reactivated", organizationId, resourceType: "website_site", resourceId: site.id, resourceName: site.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.site_reactivated", error));
  return site;
}

// --- Environments -------------------------------------------------------------

const recordEnvironmentSchema = z.object({
  siteId: z.string().uuid(),
  type: z.enum(["LOCAL", "DEVELOPMENT", "STAGING", "PRODUCTION"]),
  url: z.string().trim().max(2048).nullable().optional(),
  status: z.enum(["NOT_SET_UP", "ACTIVE", "INACTIVE"]).default("ACTIVE"),
  providerLabel: z.string().trim().max(120).nullable().optional(),
  customerVisible: z.boolean().default(false),
});

/** Insert-or-update on the site's one-and-only environment row for that type (real UNIQUE on `(siteId, type)`). No credentials of any kind — enforced by design (no such field exists on this model). */
export async function recordWebsiteEnvironment(rawInput: unknown): Promise<WebsiteEnvironment> {
  const input = parseOrThrow(recordEnvironmentSchema, rawInput);
  assertFieldsClean({ "Provider label": input.providerLabel ?? null });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  let normalizedOrigin: string | null = null;
  if (input.url) {
    try {
      normalizedOrigin = normalizeWebsiteUrl(input.url).normalizedOrigin;
    } catch (error) {
      if (error instanceof InvalidWebsiteUrlError) throw new ValidationError(error.message);
      throw error;
    }
  }

  const environment = await withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    return websiteEnvironmentRepository.upsertForType(
      generateId(),
      input.siteId,
      organizationId,
      input.type,
      context.user!.id,
      { url: input.url ?? null, normalizedOrigin, status: input.status, providerLabel: input.providerLabel ?? null, customerVisible: input.customerVisible },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "websitedev.environment_recorded", organizationId, resourceType: "website_environment", resourceId: environment.id, resourceName: `${input.type} environment`, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.environment_recorded", error));
  return environment;
}

export async function listWebsiteEnvironments(rawInput: unknown): Promise<WebsiteEnvironment[]> {
  const input = parseOrThrow(siteIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    return websiteEnvironmentRepository.listForSite(input.siteId, tx);
  });
}

// --- Pages -----------------------------------------------------------

const createPageSchema = z.object({
  siteId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(500),
  pageType: z.enum(["PAGE", "TEMPLATE", "COMPONENT", "OTHER"]).default("PAGE"),
  required: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export async function createWebsitePage(rawInput: unknown): Promise<WebsitePage> {
  const input = parseOrThrow(createPageSchema, rawInput);
  assertFieldsClean({ "Page title": input.title });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");

  let normalizedPath: string;
  try {
    normalizedPath = normalizeWebsitePagePath(input.path);
  } catch (error) {
    if (error instanceof InvalidWebsitePagePathError) throw new ValidationError(error.message);
    throw error;
  }

  const page = await withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    const existing = await websitePageRepository.findByPath(input.siteId, normalizedPath, tx);
    if (existing) throw new ConflictError(`"${normalizedPath}" is already tracked on this site.`);

    return websitePageRepository.create(
      { id: generateId(), organizationId, siteId: input.siteId, title: input.title, path: normalizedPath, pageType: input.pageType, required: input.required, sortOrder: input.sortOrder, projectTaskId: null, createdByUserId: context.user!.id },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "websitedev.page_created", organizationId, resourceType: "website_page", resourceId: page.id, resourceName: page.path, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.page_created", error));
  return page;
}

const pageIdSchema = z.object({ pageId: z.string().uuid() });

async function loadWebsitePageChecked(pageId: string, organizationId: string, tx: TransactionClient): Promise<WebsitePage> {
  const page = await websitePageRepository.findById(pageId, tx);
  if (!page || page.organizationId !== organizationId) throw new NotFoundError("Website page");
  return page;
}

export async function getWebsitePage(rawInput: unknown): Promise<WebsitePage> {
  const input = parseOrThrow(pageIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  return withTenantContext(tenantScope, (tx) => loadWebsitePageChecked(input.pageId, organizationId, tx));
}

const listPagesSchema = z.object({
  siteId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export async function listWebsitePages(rawInput: unknown): Promise<OffsetPaginatedResult<WebsitePage>> {
  const input = parseOrThrow(listPagesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: WebsitePageListFilters = { status: input.status, search: input.search };
  return withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    return websitePageRepository.listForSite(input.siteId, params, filters, tx);
  });
}

const transitionPageSchema = z.object({ pageId: z.string().uuid(), status: z.enum(["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"]) });

export async function transitionWebsitePageStatus(rawInput: unknown): Promise<WebsitePage> {
  const input = parseOrThrow(transitionPageSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.manage");
  const page = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadWebsitePageChecked(input.pageId, organizationId, tx);
    if (!canTransitionWebsitePage(existing.status as WebsitePageStatus, input.status)) throw new ValidationError(`Cannot move a ${existing.status} page to ${input.status}.`);
    const updated = await websitePageRepository.transition(input.pageId, existing.status, input.status, tx);
    if (!updated) throw new ConflictError("This page was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "websitedev.page_status_changed", organizationId, resourceType: "website_page", resourceId: page.id, resourceName: page.path, metadata: { status: page.status }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record websitedev.page_status_changed", error));
  return page;
}

// --- Launch readiness / KPI overview ---------------------------------------------------

export interface WebsiteSiteOverview {
  site: WebsiteSite;
  engagementId: string;
  /** The linked engagement's own `projectId` (nullable) — see PERF-03's own doc comment at this field's assignment site. */
  engagementProjectId: string | null;
  environments: WebsiteEnvironment[];
  pageCount: number;
  requiredPageCount: number;
  completedRequiredPageCount: number;
  requiredQaCount: number;
  passedRequiredQaCount: number;
  latestDeploymentAt: Date | null;
  readiness: LaunchReadinessResult;
}

/**
 * The site workspace's own enriched read. QA is reused DIRECTLY from
 * Project QA (`projectQaCheckRepository.listForProject()`) — Website OS
 * never builds a second QA engine (see docs/architecture/website-
 * development-os.md "QA"). If no Project is linked, `requiredQaCount`
 * is honestly `0` (no QA data to speak of), never fabricated.
 */
export async function getWebsiteSiteOverview(rawInput: unknown): Promise<WebsiteSiteOverview> {
  const input = parseOrThrow(siteIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");

  return withTenantContext(tenantScope, async (tx) => {
    const site = await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    const engagement = await websiteEngagementRepository.findById(site.engagementId, tx);
    if (!engagement) throw new NotFoundError("Website Development engagement");

    const [environments, pageCounts, qaChecks, latestDeployment] = await Promise.all([
      websiteEnvironmentRepository.listForSite(input.siteId, tx),
      websitePageRepository.countsForSite(input.siteId, tx),
      engagement.projectId ? projectQaCheckRepository.listForProject(engagement.projectId, tx) : Promise.resolve([]),
      websiteDeploymentRepository.findLatestForSite(input.siteId, tx),
    ]);

    const requiredQa = qaChecks.filter((q) => q.required);
    const passedRequiredQa = requiredQa.filter((q) => q.status === "PASSED" || q.status === "WAIVED");
    const hasProductionEnvironment = environments.some((e) => e.type === "PRODUCTION");

    const readiness = evaluateLaunchReadiness({
      siteExists: true,
      hasPrimaryDomain: site.primaryUrl !== null,
      hasProductionEnvironment,
      requiredPageCount: pageCounts.requiredPageCount,
      completedRequiredPageCount: pageCounts.completedRequiredPageCount,
      requiredQaCount: requiredQa.length,
      passedRequiredQaCount: passedRequiredQa.length,
    });

    return {
      site,
      engagementId: site.engagementId,
      // Codex Performance Engineer finding PERF-03 (Build 32 review) —
      // included here so the site page never needs a separate
      // `getWebsiteEngagement()` call (and its own independent
      // `resolveWebsiteDevScope()` resolution) purely to learn the
      // linked project id for the QA tab.
      engagementProjectId: engagement.projectId,
      environments,
      pageCount: pageCounts.pageCount,
      requiredPageCount: pageCounts.requiredPageCount,
      completedRequiredPageCount: pageCounts.completedRequiredPageCount,
      requiredQaCount: requiredQa.length,
      passedRequiredQaCount: passedRequiredQa.length,
      latestDeploymentAt: latestDeployment?.deployedAt ?? null,
      readiness,
    };
  });
}
