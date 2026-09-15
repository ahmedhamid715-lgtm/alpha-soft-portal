import "server-only";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveWebsiteDevScope } from "./website-shared";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { websiteSiteRepository } from "@/server/repositories/website-site-repository";
import { websiteEnvironmentRepository } from "@/server/repositories/website-environment-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { evaluateLaunchReadiness } from "@/lib/website-dev/launch-readiness";
import { websitePageRepository } from "@/server/repositories/website-page-repository";
import type { WebsiteServicePerformanceInput } from "@/lib/crm/client-success";

/**
 * The ONE safe read Customer 360 / Client Success are allowed to
 * compose Website Development data through (Build 32 — Roadmap Module
 * 26), mirroring `local-seo-customer-360-service.ts`'s own exact
 * "source domain owns reads" discipline. Resolves its own
 * `website_development.read` permission internally — Customer 360/
 * Client Success never escalate their own caller's privileges to read
 * Website Development data they couldn't otherwise see. A THIRD,
 * SEPARATE domain from the SEO OS/Local SEO equivalents.
 *
 * Only the customer's ACTIVE Website Development `CustomerService`
 * engagement(s) count — same "currently relevant work only" philosophy
 * every other Customer 360 specialist input already establishes.
 */
export async function getWebsiteServicePerformanceInputForCustomer360(customerOrganizationId: string): Promise<WebsiteServicePerformanceInput | null> {
  const { tenantScope } = await resolveWebsiteDevScope("website_development.read");

  return withTenantContext(tenantScope, async (tx) => {
    const customerServices = await customerServiceRepository.listForCustomerOrganization(customerOrganizationId, tx);
    const activeServiceIds = customerServices.filter((cs) => cs.status === "ACTIVE").map((cs) => cs.id);
    if (activeServiceIds.length === 0) return null;

    const definitionIds = [...new Set(customerServices.filter((cs) => activeServiceIds.includes(cs.id)).map((cs) => cs.serviceDefinitionId))];
    const definitions = await tx.serviceDefinition.findMany({ where: { id: { in: definitionIds }, category: "WEB_DEVELOPMENT" }, select: { id: true } });
    const webDevDefinitionIds = new Set(definitions.map((d) => d.id));
    const webDevServiceIds = customerServices.filter((cs) => activeServiceIds.includes(cs.id) && webDevDefinitionIds.has(cs.serviceDefinitionId)).map((cs) => cs.id);
    if (webDevServiceIds.length === 0) return null;

    const engagements = await tx.websiteEngagement.findMany({ where: { customerServiceId: { in: webDevServiceIds } }, select: { id: true, projectId: true } });
    if (engagements.length === 0) return null;

    const sites = await websiteSiteRepository.listForEngagements(
      engagements.map((e) => e.id),
      tx,
    );
    const activeSites = sites.filter((s) => s.status !== "ARCHIVED");
    if (activeSites.length === 0) return null;

    const activeSiteIds = activeSites.map((s) => s.id);
    const [environments, pageCountsBySite] = await Promise.all([websiteEnvironmentRepository.listForSites(activeSiteIds, tx), websitePageRepository.countsForSites(activeSiteIds, tx)]);
    const environmentsBySite = new Map<string, typeof environments>();
    for (const e of environments) environmentsBySite.set(e.siteId, [...(environmentsBySite.get(e.siteId) ?? []), e]);

    let anyReadinessNotReady = false;
    let anyOverdueUnlaunchedSite = false;
    let nearestUpcomingLaunchTargetDate: Date | null = null;
    const now = new Date();

    for (const site of activeSites) {
      const siteEnvironments = environmentsBySite.get(site.id) ?? [];
      const pageCounts = pageCountsBySite.get(site.id);

      const readiness = evaluateLaunchReadiness({
        siteExists: true,
        hasPrimaryDomain: site.primaryUrl !== null,
        hasProductionEnvironment: siteEnvironments.some((e) => e.type === "PRODUCTION"),
        requiredPageCount: pageCounts?.requiredPageCount ?? 0,
        completedRequiredPageCount: pageCounts?.completedRequiredPageCount ?? 0,
        // QA is engagement-scoped (via the linked Project), computed once below — treat as satisfied here to isolate the per-site page/domain/environment signal only.
        requiredQaCount: 0,
        passedRequiredQaCount: 0,
      });
      if (readiness.status === "NOT_READY") anyReadinessNotReady = true;

      if (site.status !== "LAUNCHED") {
        if (site.launchTargetDate && site.launchTargetDate.getTime() < now.getTime()) anyOverdueUnlaunchedSite = true;
        if (site.launchTargetDate && site.launchTargetDate.getTime() >= now.getTime()) {
          if (!nearestUpcomingLaunchTargetDate || site.launchTargetDate.getTime() < nearestUpcomingLaunchTargetDate.getTime()) nearestUpcomingLaunchTargetDate = site.launchTargetDate;
        }
      }
    }

    // Required QA is engagement-scoped (one Project may deliver several
    // sites) — computed ONCE across every distinct linked project, never
    // per-site (would double count).
    const linkedProjectIds = [...new Set(engagements.map((e) => e.projectId).filter((id): id is string => id !== null))];
    let requiredQaFailedCount = 0;
    let requiredQaPendingCount = 0;
    let linkedProjectStatus: WebsiteServicePerformanceInput["linkedProjectStatus"] = null;
    if (linkedProjectIds.length > 0) {
      const [qaChecks, projects] = await Promise.all([projectQaCheckRepository.listForProjects(linkedProjectIds, tx), tx.project.findMany({ where: { id: { in: linkedProjectIds } }, select: { status: true } })]);
      const requiredQa = qaChecks.filter((q) => q.required);
      requiredQaFailedCount = requiredQa.filter((q) => q.status === "FAILED").length;
      requiredQaPendingCount = requiredQa.filter((q) => q.status === "PENDING").length;
      // Worst project status wins when several projects are linked (a rare case) — same highest-severity-first discipline as everywhere else.
      const severity: Record<string, number> = { CANCELLED: 0, ON_HOLD: 1, DRAFT: 2, PLANNED: 3, ACTIVE: 4, ARCHIVED: 5, COMPLETED: 6 };
      linkedProjectStatus = projects.map((p) => p.status).sort((a, b) => (severity[a] ?? 9) - (severity[b] ?? 9))[0] ?? null;
    }

    return { activeSiteCount: activeSites.length, anyReadinessNotReady, anyOverdueUnlaunchedSite, nearestUpcomingLaunchTargetDate, linkedProjectStatus, requiredQaFailedCount, requiredQaPendingCount };
  });
}
