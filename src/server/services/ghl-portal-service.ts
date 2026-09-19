import "server-only";
import { ghlWorkspaceRepository } from "@/server/repositories/ghl-workspace-repository";
import { ghlAssetRepository } from "@/server/repositories/ghl-asset-repository";
import { ghlIntegrationRequirementRepository } from "@/server/repositories/ghl-integration-requirement-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { evaluateGhlReadiness, type GhlReadinessStatus } from "@/lib/ghl/readiness";
import type { TenantTransactionClient } from "@/lib/tenancy/context";
import type { CustomerService, GhlWorkspaceStatus, GhlHandoffStatus } from "@/generated/prisma/client";

/**
 * The Customer Portal's own customer-safe GHL Automation projection
 * (Build 34 — Roadmap Module 28). Dedicated DTO, never the internal
 * `GhlWorkspace`/`GhlAsset`/`GhlIntegrationRequirement`/
 * `GhlImportBatch` model shapes. Exposes only: workspace display name,
 * customer-safe status, go-live target/recorded dates, handoff status,
 * required-asset progress (COUNTS only — individual assets are
 * deliberately never exposed to the Portal, mirroring the narrower of
 * the two options E-Commerce's own Build 33 master prompt offered), and
 * readiness state.
 *
 * Never exposed: individual assets, `externalAssetId`/`externalLocationId`
 * (internal provider identifiers), `locationUrl` (a staff-facing
 * reference — the customer already has their own GHL login, so this is
 * never customer-relevant the way a storefront URL is in E-Commerce),
 * integration-requirement detail, internal QA detail, `notes`/
 * `handoffNotes` (staff-facing evidence text), staff identity.
 *
 * Deliberately takes an ALREADY-OPEN Portal tenant-context `tx` rather
 * than resolving its own `ghl_automation.read` scope — mirrors
 * `getEcommercePortalSummaryForCustomerServices()`'s own exact
 * reasoning: a Portal customer never holds — and never should hold — a
 * PLATFORM permission like `ghl_automation.read`; the real authorization
 * decision (`portal.access` + the caller's own organization id) already
 * happened once, in `getPortalServices()`, before this function is ever
 * reached.
 */
export interface PortalGhlAutomationSummary {
  workspaceName: string;
  status: GhlWorkspaceStatus;
  goLiveTargetDate: Date | null;
  goLiveRecordedAt: Date | null;
  handoffStatus: GhlHandoffStatus;
  requiredAssetCount: number;
  completedRequiredAssetCount: number;
  readinessStatus: GhlReadinessStatus;
}

/** `customerServices` — the SAME already-fetched `listForCustomerOrganization()` result the canonical services tier used, passed in rather than re-queried. */
export async function getGhlPortalSummaryForCustomerServices(customerServices: CustomerService[], tx: TenantTransactionClient): Promise<PortalGhlAutomationSummary | null> {
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

  // "Typically one workspace per engagement" (see architecture doc) —
  // prefer a LIVE workspace as the customer-facing headline; otherwise
  // the earliest-created active workspace.
  const primaryWorkspace = activeWorkspaces.find((w) => w.status === "LIVE") ?? activeWorkspaces[0]!;
  const primaryEngagement = engagements.find((e) => e.id === primaryWorkspace.engagementId);

  // Codex Security Engineer finding ECOM-SEC-04 (Build 33) applied
  // proactively here from the start — required QA feeds the READINESS
  // COMPUTATION itself (never exposed in the DTO beyond the rolled-up
  // status), so the Portal can never report READY while a required QA
  // check is genuinely FAILED/PENDING.
  const [assetCounts, integrationCounts, requiredQa] = await Promise.all([
    ghlAssetRepository.countsForWorkspace(primaryWorkspace.id, tx),
    ghlIntegrationRequirementRepository.countsForWorkspace(primaryWorkspace.id, tx),
    primaryEngagement?.projectId ? projectQaCheckRepository.listForProject(primaryEngagement.projectId, tx) : Promise.resolve([]),
  ]);
  const requiredQaChecks = requiredQa.filter((q) => q.required);
  const passedRequiredQa = requiredQaChecks.filter((q) => q.status === "PASSED" || q.status === "WAIVED");

  const readiness = evaluateGhlReadiness({
    workspaceExists: true,
    requiredAssetCount: assetCounts.requiredAssetCount,
    completedRequiredAssetCount: assetCounts.completedRequiredAssetCount,
    qaFailedRequiredAssetCount: assetCounts.qaFailedRequiredAssetCount,
    requiredIntegrationCount: integrationCounts.requiredCount,
    confirmedRequiredIntegrationCount: integrationCounts.confirmedRequiredCount,
    requiredQaCount: requiredQaChecks.length,
    passedRequiredQaCount: passedRequiredQa.length,
  });

  return {
    workspaceName: primaryWorkspace.name,
    status: primaryWorkspace.status,
    goLiveTargetDate: primaryWorkspace.goLiveTargetDate,
    goLiveRecordedAt: primaryWorkspace.goLiveRecordedAt,
    handoffStatus: primaryWorkspace.handoffStatus,
    requiredAssetCount: assetCounts.requiredAssetCount,
    completedRequiredAssetCount: assetCounts.completedRequiredAssetCount,
    readinessStatus: readiness.status,
  };
}
