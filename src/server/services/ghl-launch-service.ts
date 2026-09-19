import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveGhlDevScope } from "./ghl-shared";
import { ghlWorkspaceRepository } from "@/server/repositories/ghl-workspace-repository";
import { ghlEngagementRepository } from "@/server/repositories/ghl-engagement-repository";
import { ghlAssetRepository } from "@/server/repositories/ghl-asset-repository";
import { ghlIntegrationRequirementRepository } from "@/server/repositories/ghl-integration-requirement-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { loadGhlWorkspaceChecked } from "./ghl-engagement-service";
import { evaluateGhlReadiness } from "@/lib/ghl/readiness";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { GhlWorkspace } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * GHL Automation go-live/handoff recording (Build 34 — Roadmap Module
 * 28). `ghl_automation.launch` — a deliberately NARROWER tier than
 * `ghl_automation.manage` (the same tier split every specialist domain
 * in this codebase already establishes), reflecting that a recorded
 * go-live/handoff is an effectively irreversible, customer-facing act.
 *
 * This module records EVIDENCE only — a `status = LIVE` row (or a
 * `handoffStatus = COMPLETED` row) never implies Alpha OS itself
 * activated a GoHighLevel workspace, connected an integration, or
 * performed any live automation action. See
 * docs/architecture/ghl-automation-os.md "Go-live/handoff semantics."
 */

interface WorkspaceContext {
  workspaceId: string;
  engagementId: string;
  customerServiceId: string;
  ownerUserId: string | null;
  companyName: string;
  workspaceName: string;
}

/**
 * Codex Performance Engineer finding PERF-GHL-03 — returns the already-
 * loaded `workspace` row alongside its context, so callers never issue a
 * second, redundant primary-key read for the same workspace immediately
 * afterward (both `recordGhlGoLive()` and `recordGhlHandoff()` used to
 * call `loadGhlWorkspaceChecked()` a second time right after this
 * function's own internal load).
 */
async function loadWorkspaceContext(workspaceId: string, organizationId: string, tx: TransactionClient): Promise<{ context: WorkspaceContext; workspace: GhlWorkspace }> {
  const workspace = await loadGhlWorkspaceChecked(workspaceId, organizationId, tx);
  const engagement = await ghlEngagementRepository.findById(workspace.engagementId, tx);
  if (!engagement) throw new NotFoundError("GHL Automation engagement");
  const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, ownerUserId: true } });
  const company = customerService ? await tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : null;
  return {
    workspace,
    context: {
      workspaceId,
      engagementId: engagement.id,
      customerServiceId: engagement.customerServiceId,
      ownerUserId: customerService?.ownerUserId ?? null,
      companyName: company?.name ?? "Customer",
      workspaceName: workspace.name,
    },
  };
}

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

async function computeReadiness(workspace: GhlWorkspace, engagementProjectId: string | null, tx: TransactionClient) {
  const [assetCounts, integrationCounts, qaChecks] = await Promise.all([
    ghlAssetRepository.countsForWorkspace(workspace.id, tx),
    ghlIntegrationRequirementRepository.countsForWorkspace(workspace.id, tx),
    engagementProjectId ? projectQaCheckRepository.listForProject(engagementProjectId, tx) : Promise.resolve([]),
  ]);
  const requiredQa = qaChecks.filter((q) => q.required);
  const passedRequiredQa = requiredQa.filter((q) => q.status === "PASSED" || q.status === "WAIVED");
  return evaluateGhlReadiness({
    workspaceExists: true,
    requiredAssetCount: assetCounts.requiredAssetCount,
    completedRequiredAssetCount: assetCounts.completedRequiredAssetCount,
    qaFailedRequiredAssetCount: assetCounts.qaFailedRequiredAssetCount,
    requiredIntegrationCount: integrationCounts.requiredCount,
    confirmedRequiredIntegrationCount: integrationCounts.confirmedRequiredCount,
    requiredQaCount: requiredQa.length,
    passedRequiredQaCount: passedRequiredQa.length,
  });
}

const recordGoLiveSchema = z.object({
  workspaceId: z.string().uuid(),
  overrideReason: z.string().trim().max(1000).nullable().optional(),
});

/**
 * The explicit, transactional go-live operation. Requires readiness
 * (`READY`) UNLESS `overrideReason` is supplied — an override still
 * requires `ghl_automation.launch` (this codebase's smallest
 * proportionate model) AND is always durably audited with the reason
 * attached — the override audit write happens INSIDE the same
 * transaction as the go-live mutation itself (applying E-Commerce's own
 * Build 33 ECOM-SEC-03-class discipline, itself inherited from Website
 * Dev's WDEV-SEC-03, from the start: an audit-persistence failure rolls
 * back the go-live rather than silently permitting an unaudited
 * override). Never infers go-live merely because assets look complete —
 * this is the ONLY path that sets `GhlWorkspace.status = LIVE`.
 */
export async function recordGhlGoLive(rawInput: unknown): Promise<GhlWorkspace> {
  const input = parseOrThrow(recordGoLiveSchema, rawInput);
  assertFieldsClean({ "Override reason": input.overrideReason ?? null });
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.launch");

  const { workspace, workspaceContext, wasOverride } = await withTenantContext(tenantScope, async (tx) => {
    const { context: workspaceContext, workspace } = await loadWorkspaceContext(input.workspaceId, organizationId, tx);
    if (workspace.status === "LIVE") throw new ConflictError("This workspace is already recorded as go-live.");
    // Applying Website Dev's own WDEV-SEC-02 lesson from the start — an
    // archived workspace must return to an active state ONLY through
    // `reactivateGhlWorkspace()`, never go-live directly.
    if (workspace.status === "ARCHIVED") throw new ConflictError("This workspace is archived. Reactivate it before recording a go-live.");

    const engagement = await ghlEngagementRepository.findById(workspace.engagementId, tx);
    const readiness = await computeReadiness(workspace, engagement?.projectId ?? null, tx);

    const wasOverride = readiness.status !== "READY";
    if (wasOverride && !input.overrideReason) {
      throw new ValidationError(`This workspace is not go-live-ready: ${readiness.reasons.join(" ")} Provide overrideReason to record go-live anyway.`);
    }

    const updated = await ghlWorkspaceRepository.recordGoLive(input.workspaceId, new Date(), tx);
    if (!updated) throw new ConflictError("This workspace was just recorded go-live by someone else. Reload and try again.");

    if (wasOverride) {
      await audit.recordSuccess({
        action: "ghl.go_live_override_recorded",
        organizationId,
        resourceType: "ghl_workspace",
        resourceId: updated.id,
        resourceName: updated.name,
        metadata: { overrideReason: input.overrideReason },
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
        tx,
      });
    }

    return { workspace: updated, workspaceContext, wasOverride };
  });

  if (!wasOverride) {
    await audit
      .recordSuccess({
        action: "ghl.go_live_recorded",
        organizationId,
        resourceType: "ghl_workspace",
        resourceId: workspace.id,
        resourceName: workspace.name,
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
      })
      .catch((error) => console.error("[audit] failed to record ghl.go_live_recorded", error));
  }

  if (workspaceContext.ownerUserId) {
    await events.emit("ghl.go_live_recorded", { workspaceId: workspace.id, engagementId: workspaceContext.engagementId, organizationId, ownerUserId: workspaceContext.ownerUserId, workspaceName: workspace.name, companyName: workspaceContext.companyName });
  }

  return workspace;
}

const recordHandoffSchema = z.object({
  workspaceId: z.string().uuid(),
  handoffNotes: z.string().trim().max(5000).nullable().optional(),
});

/**
 * The explicit handoff-completion operation — a distinct, independently
 * CAS-guarded milestone from go-live (a workspace could in principle be
 * handed off in the same visit as go-live, or later, but never twice).
 * `handoffNotes` captures training/documentation evidence as narrative
 * text rather than fabricated boolean checkboxes — no course platform,
 * no attendance record, no customer acknowledgement is invented.
 */
export async function recordGhlHandoff(rawInput: unknown): Promise<GhlWorkspace> {
  const input = parseOrThrow(recordHandoffSchema, rawInput);
  assertFieldsClean({ "Handoff notes": input.handoffNotes ?? null });
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.launch");

  const { workspace, workspaceContext } = await withTenantContext(tenantScope, async (tx) => {
    const { context: workspaceContext, workspace } = await loadWorkspaceContext(input.workspaceId, organizationId, tx);
    if (workspace.handoffStatus === "COMPLETED") throw new ConflictError("This workspace's handoff is already recorded as completed.");

    const updated = await ghlWorkspaceRepository.recordHandoff(input.workspaceId, new Date(), input.handoffNotes ?? null, tx);
    if (!updated) throw new ConflictError("This workspace's handoff was just recorded by someone else. Reload and try again.");

    return { workspace: updated, workspaceContext };
  });

  await audit
    .recordSuccess({
      action: "ghl.handoff_recorded",
      organizationId,
      resourceType: "ghl_workspace",
      resourceId: workspace.id,
      resourceName: workspace.name,
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ghl.handoff_recorded", error));

  if (workspaceContext.ownerUserId) {
    await events.emit("ghl.handoff_recorded", { workspaceId: workspace.id, engagementId: workspaceContext.engagementId, organizationId, ownerUserId: workspaceContext.ownerUserId, workspaceName: workspace.name, companyName: workspaceContext.companyName });
  }

  return workspace;
}
