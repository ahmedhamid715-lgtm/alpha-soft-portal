import "server-only";
import { websiteSiteRepository } from "@/server/repositories/website-site-repository";
import { websiteEnvironmentRepository } from "@/server/repositories/website-environment-repository";
import { websitePageRepository } from "@/server/repositories/website-page-repository";
import { evaluateLaunchReadiness, type LaunchReadinessStatus } from "@/lib/website-dev/launch-readiness";
import type { TenantTransactionClient } from "@/lib/tenancy/context";
import type { CustomerService, WebsiteSiteStatus } from "@/generated/prisma/client";

/**
 * The Customer Portal's own customer-safe Website Development
 * projection (Build 32 — Roadmap Module 26). Dedicated DTO, never the
 * internal `WebsiteSite`/`WebsiteEnvironment`/`WebsitePage`/
 * `WebsiteDeployment` model shapes. Exposes only: site name, customer-
 * safe status, launch target/launched dates, required-page progress
 * (counts only), launch-readiness state, and the PRODUCTION url — and
 * ONLY when the site has actually launched AND staff explicitly marked
 * that environment `customerVisible`. Never staging/local/dev URLs,
 * never repository URLs, never technology/provider notes, never
 * deployment history, never QA detail, never staff identity.
 *
 * Deliberately takes an ALREADY-OPEN Portal tenant-context `tx` rather
 * than resolving its own `website_development.read` scope — mirrors
 * `getLocalSeoPortalSummaryForCustomerServices()`'s own exact reasoning:
 * a Portal customer never holds — and never should hold — a PLATFORM
 * permission like `website_development.read`; the real authorization
 * decision (`portal.access` + the caller's own organization id) already
 * happened once, in `getPortalServices()`, before this function is ever
 * reached.
 */
export interface PortalWebsiteDevelopmentSummary {
  siteCount: number;
  primarySiteName: string | null;
  status: WebsiteSiteStatus | null;
  launchTargetDate: Date | null;
  launchedAt: Date | null;
  /** Only populated once launched AND the production environment was explicitly marked customer-visible — never a staging/dev/local URL. */
  productionUrl: string | null;
  requiredPageCount: number;
  completedRequiredPageCount: number;
  readinessStatus: LaunchReadinessStatus;
}

/** `customerServices` — the SAME already-fetched `listForCustomerOrganization()` result the canonical services tier used, passed in rather than re-queried. */
export async function getWebsitePortalSummaryForCustomerServices(customerServices: CustomerService[], tx: TenantTransactionClient): Promise<PortalWebsiteDevelopmentSummary | null> {
  const activeServiceIds = customerServices.filter((cs) => cs.status === "ACTIVE").map((cs) => cs.id);
  if (activeServiceIds.length === 0) return null;

  const definitionIds = [...new Set(customerServices.filter((cs) => activeServiceIds.includes(cs.id)).map((cs) => cs.serviceDefinitionId))];
  const definitions = await tx.serviceDefinition.findMany({ where: { id: { in: definitionIds }, category: "WEB_DEVELOPMENT" }, select: { id: true } });
  const webDevDefinitionIds = new Set(definitions.map((d) => d.id));
  const webDevServiceIds = customerServices.filter((cs) => activeServiceIds.includes(cs.id) && webDevDefinitionIds.has(cs.serviceDefinitionId)).map((cs) => cs.id);
  if (webDevServiceIds.length === 0) return null;

  const engagements = await tx.websiteEngagement.findMany({ where: { customerServiceId: { in: webDevServiceIds } }, select: { id: true } });
  if (engagements.length === 0) return null;

  const sites = await websiteSiteRepository.listForEngagements(
    engagements.map((e) => e.id),
    tx,
  );
  const activeSites = sites.filter((s) => s.status !== "ARCHIVED");
  if (activeSites.length === 0) return null;

  // "Typically one site per engagement" (see architecture doc) — prefer
  // a LAUNCHED site as the customer-facing headline; otherwise the
  // earliest-created active site.
  const primarySite = activeSites.find((s) => s.status === "LAUNCHED") ?? activeSites[0]!;

  const [environments, pageCounts] = await Promise.all([websiteEnvironmentRepository.listForSite(primarySite.id, tx), websitePageRepository.countsForSite(primarySite.id, tx)]);
  const productionEnvironment = environments.find((e) => e.type === "PRODUCTION");

  const readiness = evaluateLaunchReadiness({
    siteExists: true,
    hasPrimaryDomain: primarySite.primaryUrl !== null,
    hasProductionEnvironment: productionEnvironment !== undefined,
    requiredPageCount: pageCounts.requiredPageCount,
    completedRequiredPageCount: pageCounts.completedRequiredPageCount,
    requiredQaCount: 0,
    passedRequiredQaCount: 0,
  });

  const productionUrl = primarySite.status === "LAUNCHED" && productionEnvironment?.customerVisible && productionEnvironment.url ? productionEnvironment.url : null;

  return {
    siteCount: activeSites.length,
    primarySiteName: primarySite.name,
    status: primarySite.status,
    launchTargetDate: primarySite.launchTargetDate,
    launchedAt: primarySite.launchedAt,
    productionUrl,
    requiredPageCount: pageCounts.requiredPageCount,
    completedRequiredPageCount: pageCounts.completedRequiredPageCount,
    readinessStatus: readiness.status,
  };
}
