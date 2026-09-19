import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveGhlDevScope } from "./ghl-shared";
import { ghlEngagementRepository } from "@/server/repositories/ghl-engagement-repository";
import { ghlWorkspaceRepository, type GhlWorkspaceUpdateInput } from "@/server/repositories/ghl-workspace-repository";
import { ghlAssetRepository } from "@/server/repositories/ghl-asset-repository";
import { ghlIntegrationRequirementRepository } from "@/server/repositories/ghl-integration-requirement-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { createProject } from "./project-service";
import { isHttpUrl } from "@/lib/website-dev/url";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { evaluateGhlReadiness, type GhlReadinessResult } from "@/lib/ghl/readiness";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { GhlAutomationEngagement, GhlWorkspace, CustomerService } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * GHL Automation engagement/workspace management (Build 34 — Roadmap
 * Module 28) — the specialist layer attached to exactly one
 * `CustomerService` whose `ServiceDefinition.category = GHL_AUTOMATION`.
 * A FIFTH, SEPARATE specialist domain from SEO OS/Local SEO/Website
 * Development/E-Commerce Development — see
 * docs/architecture/ghl-automation-os.md for the full architecture
 * writeup. `ghl_automation.manage` for structural mutations (engagement/
 * workspace/asset/integration-requirement create/archive);
 * `ghl_automation.read` for listing/detail.
 *
 * GHL Automation OS tracks DELIVERY of a customer's GoHighLevel
 * implementation — it is emphatically NOT GoHighLevel itself, not a
 * workflow-execution engine, and not the Alpha CRM Pipeline. No asset
 * row here is ever synchronized with, or mutates, `CrmPipeline`/
 * `CrmDeal` — verified structurally (zero FK/relation exists between
 * `GhlAsset` and any CRM pipeline table).
 */

async function assertEligibleGhlCustomerService(customerServiceId: string, organizationId: string, tx: TransactionClient): Promise<CustomerService> {
  const customerService = await customerServiceRepository.findById(customerServiceId, tx);
  if (!customerService || customerService.organizationId !== organizationId) throw new NotFoundError("Customer service");
  // Never trust a client-supplied id — re-verify the category server-side
  // even though the DB trigger will ALSO reject a mismatch on insert (a
  // SEPARATE trigger from SEO OS's/Local SEO's/Website Dev's/E-Commerce's
  // own — see the migration).
  const definition = await tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { category: true } });
  if (!definition || definition.category !== "GHL_AUTOMATION") {
    throw new ValidationError("This customer service does not use a GHL Automation service definition — a GHL Automation engagement can only attach to a service whose category is GHL_AUTOMATION.");
  }
  return customerService;
}

/**
 * Every persisted free-text field in this domain is screened for a
 * credential-shaped substring before it ever reaches the database or an
 * audit record — applied to EVERY field from the start here (Build 33's
 * own ECOM-SEC-01 finding, never repeated as a mid-build/security-review
 * discovery in this build).
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

export interface GhlEngagementListItem {
  engagement: GhlAutomationEngagement;
  companyName: string;
  serviceName: string;
  customerServiceStatus: string;
  workspaceCount: number;
}

/** Every GHL Automation engagement, bounded to 200 — same realistic-total assumption every specialist engagement list already documents. */
export async function listGhlEngagements(): Promise<GhlEngagementListItem[]> {
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  return withTenantContext(tenantScope, async (tx) => {
    const engagements = await tx.ghlAutomationEngagement.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
    if (engagements.length === 0) return [];

    const customerServiceIds = engagements.map((e) => e.customerServiceId);
    const customerServices = await tx.customerService.findMany({ where: { id: { in: customerServiceIds } }, select: { id: true, status: true, companyId: true, serviceDefinitionId: true } });
    const customerServiceById = new Map(customerServices.map((cs) => [cs.id, cs]));
    const companyIds = [...new Set(customerServices.map((cs) => cs.companyId))];
    const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
    const [companies, definitions, workspaceCounts] = await Promise.all([
      tx.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true } }),
      tx.ghlWorkspace.groupBy({ by: ["engagementId"], where: { engagementId: { in: engagements.map((e) => e.id) } }, _count: { id: true } }),
    ]);
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
    const definitionNameById = new Map(definitions.map((d) => [d.id, d.name]));
    const workspaceCountByEngagement = new Map(workspaceCounts.map((s) => [s.engagementId, s._count.id]));

    return engagements.map((engagement) => {
      const cs = customerServiceById.get(engagement.customerServiceId);
      return {
        engagement,
        companyName: cs ? (companyNameById.get(cs.companyId) ?? "Customer") : "Customer",
        serviceName: cs ? (definitionNameById.get(cs.serviceDefinitionId) ?? "GHL Automation") : "GHL Automation",
        customerServiceStatus: cs?.status ?? "UNKNOWN",
        workspaceCount: workspaceCountByEngagement.get(engagement.id) ?? 0,
      };
    });
  });
}

// --- Engagement -----------------------------------------------------------

const createEngagementSchema = z.object({ customerServiceId: z.string().uuid() });

/** Idempotent — a repeat call for the same `customerServiceId` returns the existing engagement, same pattern every specialist engagement creation function already establishes. */
export async function createGhlEngagement(rawInput: unknown): Promise<GhlAutomationEngagement> {
  const input = parseOrThrow(createEngagementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const { engagement, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await ghlEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx);
    if (existing) return { engagement: existing, wasCreated: false };

    await assertEligibleGhlCustomerService(input.customerServiceId, organizationId, tx);
    const created = await ghlEngagementRepository.create({ id: generateId(), organizationId, customerServiceId: input.customerServiceId, createdByUserId: context.user!.id }, tx);
    return { engagement: created, wasCreated: true };
  });

  if (wasCreated) {
    await audit
      .recordSuccess({ action: "ghl.engagement_created", organizationId, resourceType: "ghl_automation_engagement", resourceId: engagement.id, resourceName: "GHL Automation engagement", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record ghl.engagement_created", error));
  }
  return engagement;
}

const engagementIdSchema = z.object({ engagementId: z.string().uuid() });

export async function getGhlEngagement(rawInput: unknown): Promise<GhlAutomationEngagement> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  const engagement = await withTenantContext(tenantScope, (tx) => ghlEngagementRepository.findById(input.engagementId, tx));
  if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("GHL Automation engagement");
  return engagement;
}

const customerServiceIdSchema = z.object({ customerServiceId: z.string().uuid() });

/** `null` (never throws) when no engagement exists yet — callers (the CustomerService detail page's "Set up GHL workspace" affordance) branch on this. */
export async function getGhlEngagementByCustomerService(rawInput: unknown): Promise<GhlAutomationEngagement | null> {
  const input = parseOrThrow(customerServiceIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  const engagement = await withTenantContext(tenantScope, (tx) => ghlEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx));
  if (!engagement || engagement.organizationId !== organizationId) return null;
  return engagement;
}

export interface GhlWorkspaceSummary {
  workspace: GhlWorkspace;
  assetCount: number;
  requiredIntegrationCount: number;
}

export interface GhlEngagementDetail {
  engagement: GhlAutomationEngagement;
  customerServiceId: string;
  companyName: string;
  serviceName: string;
  linkedProjectTitle: string | null;
  workspaces: GhlWorkspaceSummary[];
}

/** The engagement workspace's own enriched read — bounded batch, never one query per workspace. Resolves `ghl_automation.read` exactly ONCE (applying Build 31/32/33's own PERF lesson from the start). */
export async function getGhlEngagementDetail(rawInput: unknown): Promise<GhlEngagementDetail> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");

  return withTenantContext(tenantScope, async (tx) => {
    const engagement = await ghlEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("GHL Automation engagement");

    const [customerService, workspaces, linkedProject] = await Promise.all([
      tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, serviceDefinitionId: true } }),
      ghlWorkspaceRepository.listForEngagement(engagement.id, tx),
      engagement.projectId ? tx.project.findUnique({ where: { id: engagement.projectId }, select: { title: true } }) : Promise.resolve(null),
    ]);
    const [company, definition] = await Promise.all([
      customerService ? tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : Promise.resolve(null),
      customerService ? tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    const workspaceIds = workspaces.map((w) => w.id);
    const [assetCountsByWorkspace, integrationCountsByWorkspace] = await Promise.all([ghlAssetRepository.countsForWorkspaces(workspaceIds, tx), ghlIntegrationRequirementRepository.countsForWorkspaces(workspaceIds, tx)]);

    const workspaceSummaries: GhlWorkspaceSummary[] = workspaces.map((workspace) => ({
      workspace,
      assetCount: assetCountsByWorkspace.get(workspace.id)?.assetCount ?? 0,
      requiredIntegrationCount: integrationCountsByWorkspace.get(workspace.id)?.requiredCount ?? 0,
    }));

    return {
      engagement,
      customerServiceId: engagement.customerServiceId,
      companyName: company?.name ?? "Customer",
      serviceName: definition?.name ?? "GHL Automation",
      linkedProjectTitle: linkedProject?.title ?? null,
      workspaces: workspaceSummaries,
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
export async function createAndLinkGhlProject(rawInput: unknown): Promise<GhlAutomationEngagement> {
  const input = parseOrThrow(linkNewProjectSchema, rawInput);
  assertFieldsClean({ "Project title": input.title, "Project description": input.description ?? null });
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const { engagement, customerServiceId, customerOrganizationId, companyId } = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await ghlEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("GHL Automation engagement");
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
    const result = await tx.ghlAutomationEngagement.updateMany({ where: { id: engagement.id, projectId: null }, data: { projectId: project.id } });
    if (result.count === 0) throw new ConflictError("This engagement was just linked to a project by someone else. Reload and try again.");
    return ghlEngagementRepository.findById(engagement.id, tx);
  });
  if (!linked) throw new NotFoundError("GHL Automation engagement");

  await audit
    .recordSuccess({ action: "ghl.project_linked", organizationId, resourceType: "ghl_automation_engagement", resourceId: linked.id, resourceName: input.title, metadata: { projectId: project.id }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.project_linked", error));
  return linked;
}

const linkExistingProjectSchema = z.object({ engagementId: z.string().uuid(), projectId: z.string().uuid() });

/** Links an EXISTING project — structurally verified to belong to the SAME platform organization and the SAME customer organization as the engagement before linking. */
export async function linkExistingGhlProject(rawInput: unknown): Promise<GhlAutomationEngagement> {
  const input = parseOrThrow(linkExistingProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const engagement = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await ghlEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("GHL Automation engagement");
    if (engagement.projectId) throw new ConflictError("This engagement is already linked to a project.");

    const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { customerOrganizationId: true } });
    if (!customerService) throw new NotFoundError("Customer service");

    const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { organizationId: true, customerOrganizationId: true } });
    if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");
    if (project.customerOrganizationId !== customerService.customerOrganizationId) {
      throw new ValidationError("This project belongs to a different customer organization than this GHL Automation engagement.");
    }

    const result = await tx.ghlAutomationEngagement.updateMany({ where: { id: engagement.id, projectId: null }, data: { projectId: input.projectId } });
    if (result.count === 0) throw new ConflictError("This engagement was just linked to a project by someone else. Reload and try again.");
    return ghlEngagementRepository.findById(engagement.id, tx);
  });
  if (!engagement) throw new NotFoundError("GHL Automation engagement");

  await audit
    .recordSuccess({ action: "ghl.project_linked", organizationId, resourceType: "ghl_automation_engagement", resourceId: engagement.id, resourceName: "GHL Automation engagement", metadata: { projectId: input.projectId }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.project_linked", error));
  return engagement;
}

// --- Workspaces -------------------------------------------------------------

const createWorkspaceSchema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  externalLocationId: z.string().trim().max(200).nullable().optional(),
  locationUrl: z.string().trim().max(2048).nullable().optional(),
});

export async function createGhlWorkspace(rawInput: unknown): Promise<GhlWorkspace> {
  const input = parseOrThrow(createWorkspaceSchema, rawInput);
  assertFieldsClean({ "Workspace name": input.name, "External location ID": input.externalLocationId ?? null, "Location URL": input.locationUrl ?? null });
  if (input.locationUrl && !isHttpUrl(input.locationUrl)) throw new ValidationError("locationUrl must use http:// or https://");
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const workspace = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await ghlEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("GHL Automation engagement");

    if (input.externalLocationId) {
      const existing = await ghlWorkspaceRepository.findByExternalLocationId(input.engagementId, input.externalLocationId, tx);
      if (existing) throw new ConflictError(`"${input.externalLocationId}" is already tracked as a workspace identifier on this engagement.`);
    }

    return ghlWorkspaceRepository.create(
      {
        id: generateId(),
        organizationId,
        engagementId: input.engagementId,
        name: input.name,
        externalLocationId: input.externalLocationId ?? null,
        locationUrl: input.locationUrl ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "ghl.workspace_created", organizationId, resourceType: "ghl_workspace", resourceId: workspace.id, resourceName: workspace.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.workspace_created", error));
  return workspace;
}

const workspaceIdSchema = z.object({ workspaceId: z.string().uuid() });

export async function loadGhlWorkspaceChecked(workspaceId: string, organizationId: string, tx: TransactionClient): Promise<GhlWorkspace> {
  const workspace = await ghlWorkspaceRepository.findById(workspaceId, tx);
  if (!workspace || workspace.organizationId !== organizationId) throw new NotFoundError("GHL workspace");
  return workspace;
}

const updateWorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  externalLocationId: z.string().trim().max(200).nullable().optional(),
  locationUrl: z.string().trim().max(2048).nullable().optional(),
  goLiveTargetDate: z.coerce.date().nullable().optional(),
});

export async function updateGhlWorkspace(rawInput: unknown): Promise<GhlWorkspace> {
  const input = parseOrThrow(updateWorkspaceSchema, rawInput);
  assertFieldsClean({ "Workspace name": input.name ?? null, "External location ID": input.externalLocationId ?? null, "Location URL": input.locationUrl ?? null });
  if (input.locationUrl && !isHttpUrl(input.locationUrl)) throw new ValidationError("locationUrl must use http:// or https://");
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const { workspaceId, ...rest } = input;
  const workspace = await withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(workspaceId, organizationId, tx);
    return ghlWorkspaceRepository.update(workspaceId, rest as GhlWorkspaceUpdateInput, tx);
  });

  await audit
    .recordSuccess({ action: "ghl.workspace_created", organizationId, resourceType: "ghl_workspace", resourceId: workspace.id, resourceName: workspace.name, metadata: { updated: true }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.workspace_created", error));
  return workspace;
}

export async function archiveGhlWorkspace(rawInput: unknown): Promise<GhlWorkspace> {
  const input = parseOrThrow(workspaceIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");
  const workspace = await withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    const updated = await ghlWorkspaceRepository.archive(input.workspaceId, tx);
    if (!updated) throw new ConflictError("This workspace was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "ghl.workspace_archived", organizationId, resourceType: "ghl_workspace", resourceId: workspace.id, resourceName: workspace.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.workspace_archived", error));
  return workspace;
}

export async function reactivateGhlWorkspace(rawInput: unknown): Promise<GhlWorkspace> {
  const input = parseOrThrow(workspaceIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");
  const workspace = await withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    // Restores to IN_DEVELOPMENT, never silently back to LIVE — a real
    // go-live must be re-recorded via `recordGhlGoLive()`.
    const updated = await ghlWorkspaceRepository.reactivate(input.workspaceId, "IN_DEVELOPMENT", tx);
    if (!updated) throw new ConflictError("This workspace was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "ghl.workspace_reactivated", organizationId, resourceType: "ghl_workspace", resourceId: workspace.id, resourceName: workspace.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.workspace_reactivated", error));
  return workspace;
}

// --- Overview / go-live readiness ---------------------------------------------------

export interface GhlWorkspaceOverview {
  workspace: GhlWorkspace;
  engagementId: string;
  assetCount: number;
  requiredAssetCount: number;
  completedRequiredAssetCount: number;
  qaFailedRequiredAssetCount: number;
  requiredIntegrationCount: number;
  confirmedRequiredIntegrationCount: number;
  requiredQaCount: number;
  passedRequiredQaCount: number;
  readiness: GhlReadinessResult;
}

/**
 * The workspace workspace's own enriched read. QA is reused DIRECTLY
 * from Project QA (`projectQaCheckRepository.listForProject()`) — GHL
 * Automation OS never builds a second QA engine. Unlike E-Commerce's own
 * overview, there is no cross-domain readiness input here — a GHL
 * workspace has no structural link to any other specialist domain's own
 * delivery surface, so every input is resolved from this domain plus
 * Project QA alone.
 */
export async function getGhlWorkspaceOverview(rawInput: unknown): Promise<GhlWorkspaceOverview> {
  const input = parseOrThrow(workspaceIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");

  const { workspace, assetCounts, integrationCounts, requiredQa } = await withTenantContext(tenantScope, async (tx) => {
    const workspace = await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    const engagement = await ghlEngagementRepository.findById(workspace.engagementId, tx);
    if (!engagement) throw new NotFoundError("GHL Automation engagement");

    const [assetCounts, integrationCounts, qaChecks] = await Promise.all([
      ghlAssetRepository.countsForWorkspace(input.workspaceId, tx),
      ghlIntegrationRequirementRepository.countsForWorkspace(input.workspaceId, tx),
      engagement.projectId ? projectQaCheckRepository.listForProject(engagement.projectId, tx) : Promise.resolve([]),
    ]);
    const requiredQa = qaChecks.filter((q) => q.required);
    return { workspace, assetCounts, integrationCounts, requiredQa };
  });

  const passedRequiredQa = requiredQa.filter((q) => q.status === "PASSED" || q.status === "WAIVED");

  const readiness = evaluateGhlReadiness({
    workspaceExists: true,
    requiredAssetCount: assetCounts.requiredAssetCount,
    completedRequiredAssetCount: assetCounts.completedRequiredAssetCount,
    qaFailedRequiredAssetCount: assetCounts.qaFailedRequiredAssetCount,
    requiredIntegrationCount: integrationCounts.requiredCount,
    confirmedRequiredIntegrationCount: integrationCounts.confirmedRequiredCount,
    requiredQaCount: requiredQa.length,
    passedRequiredQaCount: passedRequiredQa.length,
  });

  return {
    workspace,
    engagementId: workspace.engagementId,
    assetCount: assetCounts.assetCount,
    requiredAssetCount: assetCounts.requiredAssetCount,
    completedRequiredAssetCount: assetCounts.completedRequiredAssetCount,
    qaFailedRequiredAssetCount: assetCounts.qaFailedRequiredAssetCount,
    requiredIntegrationCount: integrationCounts.requiredCount,
    confirmedRequiredIntegrationCount: integrationCounts.confirmedRequiredCount,
    requiredQaCount: requiredQa.length,
    passedRequiredQaCount: passedRequiredQa.length,
    readiness,
  };
}
