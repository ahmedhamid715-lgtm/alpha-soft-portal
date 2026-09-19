import "server-only";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveGhlDevScope } from "./ghl-shared";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { ghlWorkspaceRepository } from "@/server/repositories/ghl-workspace-repository";
import { ghlAssetRepository } from "@/server/repositories/ghl-asset-repository";
import { ghlIntegrationRequirementRepository } from "@/server/repositories/ghl-integration-requirement-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { evaluateGhlReadiness } from "@/lib/ghl/readiness";
import type { GhlServicePerformanceInput } from "@/lib/crm/client-success";

/**
 * The ONE safe read Customer 360 / Client Success are allowed to
 * compose GHL Automation data through (Build 34 — Roadmap Module 28),
 * mirroring `ecommerce-customer-360-service.ts`'s own exact "source
 * domain owns reads" discipline. Resolves its own `ghl_automation.read`
 * permission internally — Customer 360/Client Success never escalate
 * their own caller's privileges to read GHL Automation data they
 * couldn't otherwise see. A FIFTH, SEPARATE domain from SEO OS/Local
 * SEO/Website Dev/E-Commerce's own equivalents.
 *
 * Unlike E-Commerce's own equivalent, there is no cross-domain
 * readiness input to resolve here (no `PermissionDeniedError` handling
 * needed) — a GHL workspace has no structural link to any other
 * specialist domain's own delivery surface.
 *
 * Only the customer's ACTIVE GHL Automation `CustomerService`
 * engagement(s) count — same "currently relevant work only" philosophy
 * every other Customer 360 specialist input already establishes.
 */
export async function getGhlServicePerformanceInputForCustomer360(customerOrganizationId: string): Promise<GhlServicePerformanceInput | null> {
  const { tenantScope } = await resolveGhlDevScope("ghl_automation.read");

  return withTenantContext(tenantScope, async (tx) => {
    const customerServices = await customerServiceRepository.listForCustomerOrganization(customerOrganizationId, tx);
    const activeServiceIds = customerServices.filter((cs) => cs.status === "ACTIVE").map((cs) => cs.id);
    if (activeServiceIds.length === 0) return null;

    const definitionIds = [...new Set(customerServices.filter((cs) => activeServiceIds.includes(cs.id)).map((cs) => cs.serviceDefinitionId))];
    const definitions = await tx.serviceDefinition.findMany({ where: { id: { in: definitionIds }, category: "GHL_AUTOMATION" }, select: { id: true } });
    const ghlDefinitionIds = new Set(definitions.map((d) => d.id));
    const ghlServiceIds = customerServices.filter((cs) => activeServiceIds.includes(cs.id) && ghlDefinitionIds.has(cs.serviceDefinitionId)).map((cs) => cs.id);
    if (ghlServiceIds.length === 0) return null;

    const engagements = await tx.ghlAutomationEngagement.findMany({ where: { customerServiceId: { in: ghlServiceIds } }, select: { id: true, projectId: true } });
    if (engagements.length === 0) return null;

    const workspaces = await ghlWorkspaceRepository.listForEngagements(
      engagements.map((e) => e.id),
      tx,
    );
    const activeWorkspaces = workspaces.filter((w) => w.status !== "ARCHIVED");
    if (activeWorkspaces.length === 0) return null;

    const activeWorkspaceIds = activeWorkspaces.map((w) => w.id);
    const [assetCountsByWorkspace, integrationCountsByWorkspace] = await Promise.all([ghlAssetRepository.countsForWorkspaces(activeWorkspaceIds, tx), ghlIntegrationRequirementRepository.countsForWorkspaces(activeWorkspaceIds, tx)]);

    let anyReadinessNotReady = false;
    let anyOverdueUnlaunchedWorkspace = false;
    let nearestUpcomingGoLiveTargetDate: Date | null = null;
    const now = new Date();

    for (const workspace of activeWorkspaces) {
      const assetCounts = assetCountsByWorkspace.get(workspace.id);
      const integrationCounts = integrationCountsByWorkspace.get(workspace.id);

      const readiness = evaluateGhlReadiness({
        workspaceExists: true,
        requiredAssetCount: assetCounts?.requiredAssetCount ?? 0,
        completedRequiredAssetCount: assetCounts?.completedRequiredAssetCount ?? 0,
        qaFailedRequiredAssetCount: assetCounts?.qaFailedRequiredAssetCount ?? 0,
        requiredIntegrationCount: integrationCounts?.requiredCount ?? 0,
        confirmedRequiredIntegrationCount: integrationCounts?.confirmedRequiredCount ?? 0,
        // QA is engagement-scoped (via the linked Project), computed once below — treat as satisfied here to isolate the per-workspace asset/integration readiness signal only.
        requiredQaCount: 0,
        passedRequiredQaCount: 0,
      });
      if (readiness.status === "NOT_READY") anyReadinessNotReady = true;

      if (workspace.status !== "LIVE") {
        if (workspace.goLiveTargetDate && workspace.goLiveTargetDate.getTime() < now.getTime()) anyOverdueUnlaunchedWorkspace = true;
        if (workspace.goLiveTargetDate && workspace.goLiveTargetDate.getTime() >= now.getTime()) {
          if (!nearestUpcomingGoLiveTargetDate || workspace.goLiveTargetDate.getTime() < nearestUpcomingGoLiveTargetDate.getTime()) nearestUpcomingGoLiveTargetDate = workspace.goLiveTargetDate;
        }
      }
    }

    // Required QA is engagement-scoped (one Project may deliver several
    // workspaces) — computed ONCE across every distinct linked project,
    // never per-workspace (would double count).
    const linkedProjectIds = [...new Set(engagements.map((e) => e.projectId).filter((id): id is string => id !== null))];
    let requiredQaFailedCount = 0;
    let requiredQaPendingCount = 0;
    let linkedProjectStatus: GhlServicePerformanceInput["linkedProjectStatus"] = null;
    if (linkedProjectIds.length > 0) {
      const [qaChecks, projects] = await Promise.all([projectQaCheckRepository.listForProjects(linkedProjectIds, tx), tx.project.findMany({ where: { id: { in: linkedProjectIds } }, select: { status: true } })]);
      const requiredQa = qaChecks.filter((q) => q.required);
      requiredQaFailedCount = requiredQa.filter((q) => q.status === "FAILED").length;
      requiredQaPendingCount = requiredQa.filter((q) => q.status === "PENDING").length;
      // Worst project status wins when several projects are linked (a rare case) — same highest-severity-first discipline as everywhere else.
      const severity: Record<string, number> = { CANCELLED: 0, ON_HOLD: 1, DRAFT: 2, PLANNED: 3, ACTIVE: 4, ARCHIVED: 5, COMPLETED: 6 };
      linkedProjectStatus = projects.map((p) => p.status).sort((a, b) => (severity[a] ?? 9) - (severity[b] ?? 9))[0] ?? null;
    }

    return { activeWorkspaceCount: activeWorkspaces.length, anyReadinessNotReady, anyOverdueUnlaunchedWorkspace, nearestUpcomingGoLiveTargetDate, linkedProjectStatus, requiredQaFailedCount, requiredQaPendingCount };
  });
}
