import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withPortalCrmReadContext, resolvePortalCrmCompany, resolvePortalCurrentOnboarding } from "./portal-crm-bridge";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmProposalVersionRepository } from "@/server/repositories/crm-proposal-version-repository";
import { crmProposalLineItemRepository } from "@/server/repositories/crm-proposal-line-item-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { projectRepository } from "@/server/repositories/project-repository";
import { getSeoPortalSummaryForCustomerServices, type PortalSeoPerformanceSummary } from "@/server/services/seo-portal-service";
import { getLocalSeoPortalSummaryForCustomerServices, type PortalLocalSeoPerformanceSummary } from "@/server/services/local-seo-portal-service";
import { getWebsitePortalSummaryForCustomerServices, type PortalWebsiteDevelopmentSummary } from "@/server/services/website-portal-service";
import { getEcommercePortalSummaryForCustomerServices, type PortalEcommerceDevelopmentSummary } from "@/server/services/ecommerce-portal-service";
import { getGhlPortalSummaryForCustomerServices, type PortalGhlAutomationSummary } from "@/server/services/ghl-portal-service";
import type { CrmCompany, CustomerServiceStatus, ServiceCategory } from "@/generated/prisma/client";
import type { CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";
import type { TenantTransactionClient } from "@/lib/tenancy/context";

/**
 * "My Services" (Build 26, upgraded Build 29) — three possible real
 * sources, same precedence Customer 360's own `resolveServices()`
 * already establishes for the identical reason (see
 * service-management.md "Customer Portal integration"): a real,
 * canonical `CustomerService` (Build 29) is the most current
 * operational truth and takes precedence; the onboarding service-item
 * snapshot is next (once onboarding has started); the accepted
 * proposal's own line items are the last-resort commercial record.
 * Only customer-safe fields are returned for every tier — no internal
 * owner identity, no discount mechanics, no staff notes, no internal
 * project data (customer-visible project titles only, DRAFT excluded).
 */
export interface PortalServiceItem {
  title: string;
  description: string | null;
  quantity: number;
}

export interface PortalCanonicalServiceItem {
  id: string;
  title: string;
  description: string | null;
  status: CustomerServiceStatus;
  category: ServiceCategory;
  startDate: Date | null;
  targetEndDate: Date | null;
  linkedProjects: { id: string; title: string }[];
  /** Build 30 — SEO OS's own customer-safe projection, only ever non-null when `category === "SEO"`. Aggregated across every ACTIVE SEO engagement, not fetched per item (see `getSeoPortalSummaryForCustomerServices()`'s own doc comment). */
  seoPerformance: PortalSeoPerformanceSummary | null;
  /** Build 31 — Local SEO's own SEPARATE customer-safe projection, only ever non-null when `category === "LOCAL_SEO"`. Aggregated across every ACTIVE Local SEO engagement, not fetched per item. */
  localSeoPerformance: PortalLocalSeoPerformanceSummary | null;
  /** Build 32 — Website Development's own SEPARATE customer-safe projection, only ever non-null when `category === "WEB_DEVELOPMENT"`. Aggregated across every ACTIVE Website Development engagement, not fetched per item. */
  websiteDevPerformance: PortalWebsiteDevelopmentSummary | null;
  /** Build 33 — E-Commerce Development's own SEPARATE customer-safe projection, only ever non-null when `category === "ECOMMERCE"`. Aggregated across every ACTIVE E-Commerce Development engagement, not fetched per item. */
  ecommercePerformance: PortalEcommerceDevelopmentSummary | null;
  /** Build 34 — GHL Automation's own SEPARATE customer-safe projection, only ever non-null when `category === "GHL_AUTOMATION"`. Aggregated across every ACTIVE GHL Automation engagement, not fetched per item. */
  ghlPerformance: PortalGhlAutomationSummary | null;
}

export type PortalServices = { source: "onboarding" | "accepted_proposal" | "none"; items: PortalServiceItem[] } | { source: "canonical"; items: PortalCanonicalServiceItem[] };

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** The canonical tier — bounded to this customer organization's own `CustomerService` rows (`listForCustomerOrganization()`'s own 50-row cap). Returns `null` (never `[]` treated ambiguously) when there are genuinely zero rows, so the caller falls through to the next tier exactly like every other "not present" case in this precedence chain. */
/**
 * Codex Performance Engineer finding (Build 29 review) — batches
 * definition and project resolution into ONE query each, never one per
 * `CustomerService` (the original per-service `Promise.all(...map(...))`
 * shape was a real N+1 at this function's own documented 50-row
 * ceiling — up to 101 domain queries for one page load). See
 * `projectRepository.listForCustomerServices()`'s own doc comment and
 * `serviceDefinitionRepository`'s sibling batch usage in
 * `customer-service-service.ts`'s `listServicesForCustomer360()`.
 */
async function resolveCanonicalServices(customerOrganizationId: string, tx: TenantTransactionClient): Promise<PortalCanonicalServiceItem[] | null> {
  const customerServices = await customerServiceRepository.listForCustomerOrganization(customerOrganizationId, tx);
  if (customerServices.length === 0) return null;

  const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
  const customerServiceIds = customerServices.map((cs) => cs.id);
  const [definitions, linkedProjects, seoPerformance, localSeoPerformance, websiteDevPerformance, ecommercePerformance, ghlPerformance] = await Promise.all([
    tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true, description: true, category: true } }),
    projectRepository.listForCustomerServices(customerServiceIds, tx),
    getSeoPortalSummaryForCustomerServices(customerServices, tx),
    getLocalSeoPortalSummaryForCustomerServices(customerServices, tx),
    getWebsitePortalSummaryForCustomerServices(customerServices, tx),
    getEcommercePortalSummaryForCustomerServices(customerServices, tx),
    getGhlPortalSummaryForCustomerServices(customerServices, tx),
  ]);
  const definitionById = new Map(definitions.map((d) => [d.id, d]));
  const projectsByServiceId = new Map<string, { id: string; title: string; status: string }[]>();
  for (const project of linkedProjects) {
    if (!project.customerServiceId) continue;
    const list = projectsByServiceId.get(project.customerServiceId) ?? [];
    list.push(project);
    projectsByServiceId.set(project.customerServiceId, list);
  }

  return customerServices.map((cs) => {
    const definition = definitionById.get(cs.serviceDefinitionId);
    // DRAFT projects are never customer-visible — same exclusion Build
    // 26/27's own `listMyProjects()` already establishes.
    const visibleProjects = (projectsByServiceId.get(cs.id) ?? []).filter((p) => p.status !== "DRAFT");
    const category = definition?.category ?? ("OTHER" as ServiceCategory);
    return {
      id: cs.id,
      title: definition?.name ?? "Service",
      description: definition?.description ?? null,
      status: cs.status,
      category,
      startDate: cs.startDate,
      targetEndDate: cs.targetEndDate,
      linkedProjects: visibleProjects.map((p) => ({ id: p.id, title: p.title })),
      seoPerformance: category === "SEO" ? seoPerformance : null,
      localSeoPerformance: category === "LOCAL_SEO" ? localSeoPerformance : null,
      websiteDevPerformance: category === "WEB_DEVELOPMENT" ? websiteDevPerformance : null,
      ecommercePerformance: category === "ECOMMERCE" ? ecommercePerformance : null,
      ghlPerformance: category === "GHL_AUTOMATION" ? ghlPerformance : null,
    };
  });
}

export async function getPortalServices(rawInput: unknown, precomputedCrmCompany?: CrmCompany | null, precomputedOnboarding?: CrmClientOnboardingWithRelations | null): Promise<PortalServices> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;

  // Codex Performance Engineer finding — same short-circuit as
  // `getPortalOnboardingStatus()`'s own identical comment.
  if (precomputedCrmCompany === null) return { source: "none", items: [] };

  return withPortalCrmReadContext(userId, async (tx) => {
    const canonical = await resolveCanonicalServices(input.organizationId, tx);
    if (canonical) return { source: "canonical", items: canonical };

    const crmCompany = precomputedCrmCompany !== undefined ? precomputedCrmCompany : await resolvePortalCrmCompany(input.organizationId, userId, tx);
    if (!crmCompany) return { source: "none", items: [] };

    const onboarding = precomputedOnboarding !== undefined ? precomputedOnboarding : await resolvePortalCurrentOnboarding(crmCompany, tx);
    if (onboarding) {
      const serviceItems = await crmClientOnboardingServiceItemRepository.listForOnboarding(onboarding.id, tx);
      if (serviceItems.length > 0) {
        return { source: "onboarding", items: serviceItems.map((s) => ({ title: s.title, description: s.description, quantity: s.quantity })) };
      }
    }

    const proposals = await crmProposalRepository.listForOrganization(crmCompany.organizationId, { companyId: crmCompany.id, status: "ACCEPTED" }, tx);
    const accepted = proposals[0] ?? null;
    if (!accepted?.currentVersionId) return { source: "none", items: [] };

    const version = await crmProposalVersionRepository.findById(accepted.currentVersionId, tx);
    if (!version) return { source: "none", items: [] };

    const lineItems = await crmProposalLineItemRepository.listForVersion(version.id, tx);
    return { source: "accepted_proposal", items: lineItems.map((li) => ({ title: li.title, description: li.description, quantity: li.quantity })) };
  });
}
