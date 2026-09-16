import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveWebsiteDevScope } from "./website-shared";
import { websiteSiteRepository } from "@/server/repositories/website-site-repository";
import { websiteEnvironmentRepository } from "@/server/repositories/website-environment-repository";
import { websiteDeploymentRepository } from "@/server/repositories/website-deployment-repository";
import { websiteEngagementRepository } from "@/server/repositories/website-engagement-repository";
import { websitePageRepository } from "@/server/repositories/website-page-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { loadWebsiteSiteChecked } from "./website-engagement-service";
import { evaluateLaunchReadiness } from "@/lib/website-dev/launch-readiness";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { WebsiteDeployment, WebsiteSite } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Website Development deployment/launch recording (Build 32 — Roadmap
 * Module 26). `website_development.deploy` for recording deployments,
 * launches (including a readiness override), and rollbacks — a
 * deliberately NARROWER tier than `website_development.manage` (the
 * same `seo.measurements.manage`-vs-`.manage` split every specialist
 * domain in this codebase already establishes), reflecting that a
 * recorded launch is an effectively irreversible, customer-facing act.
 *
 * Every operation here is EVIDENCE, never an action Alpha OS itself
 * performed — see docs/architecture/website-development-os.md "No fake
 * deployment"/"Launch"/"Rollback."
 */

interface SiteContext {
  siteId: string;
  engagementId: string;
  customerServiceId: string;
  ownerUserId: string | null;
  companyName: string;
  siteName: string;
}

/** WDEV-SEC-01 (Codex Security Engineer, Build 32) — same domain-wide credential-content screen `website-engagement-service.ts`'s own `assertFieldsClean()` applies, mirrored here for this file's own free-text inputs (deployment notes/version label, launch override reason — the exact field the finding's own audit-metadata reproduction used). */
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

async function loadSiteContext(siteId: string, organizationId: string, tx: TransactionClient): Promise<SiteContext> {
  const site = await loadWebsiteSiteChecked(siteId, organizationId, tx);
  const engagement = await websiteEngagementRepository.findById(site.engagementId, tx);
  if (!engagement) throw new NotFoundError("Website Development engagement");
  const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, ownerUserId: true } });
  const company = customerService ? await tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : null;
  return {
    siteId,
    engagementId: engagement.id,
    customerServiceId: engagement.customerServiceId,
    ownerUserId: customerService?.ownerUserId ?? null,
    companyName: company?.name ?? "Customer",
    siteName: site.name,
  };
}

// --- Deployments ---------------------------------------------------

const recordDeploymentSchema = z.object({
  siteId: z.string().uuid(),
  environmentId: z.string().uuid(),
  deployedAt: z.coerce.date(),
  status: z.enum(["SUCCEEDED", "FAILED", "ROLLED_BACK"]),
  versionLabel: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  rollbackOfDeploymentId: z.string().uuid().nullable().optional(),
});

/** Records a deployment EVENT — never implies Alpha OS itself deployed anything. `environmentId` is verified to belong to the SAME site. A `ROLLED_BACK`-status row without `rollbackOfDeploymentId` is valid (a rollback recorded without a known prior deployment reference — still honest evidence, just less linked). */
export async function recordWebsiteDeployment(rawInput: unknown): Promise<WebsiteDeployment> {
  const input = parseOrThrow(recordDeploymentSchema, rawInput);
  assertFieldsClean({ "Version label": input.versionLabel ?? null, Notes: input.notes ?? null });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.deploy");

  const { deployment, siteContext, environmentLabel } = await withTenantContext(tenantScope, async (tx) => {
    const siteContext = await loadSiteContext(input.siteId, organizationId, tx);
    const environment = await websiteEnvironmentRepository.findById(input.environmentId, tx);
    if (!environment || environment.organizationId !== organizationId || environment.siteId !== input.siteId) throw new NotFoundError("Website environment");

    if (input.rollbackOfDeploymentId) {
      const rollbackTarget = await websiteDeploymentRepository.findById(input.rollbackOfDeploymentId, tx);
      if (!rollbackTarget || rollbackTarget.organizationId !== organizationId || rollbackTarget.siteId !== input.siteId) throw new NotFoundError("Deployment being rolled back");
    }

    const created = await websiteDeploymentRepository.create(
      {
        id: generateId(),
        organizationId,
        siteId: input.siteId,
        environmentId: input.environmentId,
        deployedAt: input.deployedAt,
        status: input.status,
        versionLabel: input.versionLabel ?? null,
        notes: input.notes ?? null,
        rollbackOfDeploymentId: input.rollbackOfDeploymentId ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
    return { deployment: created, siteContext, environmentLabel: environment.type };
  });

  await audit
    .recordSuccess({
      action: "websitedev.deployment_recorded",
      organizationId,
      resourceType: "website_deployment",
      resourceId: deployment.id,
      resourceName: `${siteContext.siteName} — ${deployment.status}`,
      metadata: { status: deployment.status, environmentId: input.environmentId },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record websitedev.deployment_recorded", error));

  if (deployment.status === "FAILED" && siteContext.ownerUserId) {
    await events.emit("websitedev.deployment_failed", {
      deploymentId: deployment.id,
      engagementId: siteContext.engagementId,
      organizationId,
      ownerUserId: siteContext.ownerUserId,
      siteName: siteContext.siteName,
      environmentLabel,
      companyName: siteContext.companyName,
    });
  }

  return deployment;
}

const listDeploymentsSchema = z.object({ siteId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function listWebsiteDeployments(rawInput: unknown): Promise<WebsiteDeployment[]> {
  const input = parseOrThrow(listDeploymentsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    return websiteDeploymentRepository.listForSite(input.siteId, input.limit, tx);
  });
}

// --- Launch -----------------------------------------------------------

const recordLaunchSchema = z.object({
  siteId: z.string().uuid(),
  launchDeploymentId: z.string().uuid().nullable().optional(),
  overrideReason: z.string().trim().max(1000).nullable().optional(),
});

/**
 * The explicit, transactional launch operation. Requires launch
 * readiness (`READY`) UNLESS `overrideReason` is supplied — an override
 * still requires `website_development.deploy` (the same permission as
 * an ordinary launch; this codebase's smallest proportionate model,
 * documented as the frozen decision rather than inventing a fourth
 * permission key) AND is always durably audited with the reason
 * attached (WDEV-SEC-03 — the override audit write happens inside the
 * SAME transaction as the launch mutation itself, so an audit failure
 * rolls back the launch rather than silently permitting an unaudited
 * override), never silently permitted. Never infers launch merely
 * because a production URL/environment exists — this is the ONLY path
 * that sets `WebsiteSite.status = LAUNCHED`.
 *
 * `launchDeploymentId` (WDEV-SEC-06 review note) is a deliberate,
 * AUTHORIZED, server-validated user SELECTION — the staff member
 * recording the launch identifies which already-recorded deployment
 * corresponds to it — never a system-computed field. It is independently
 * re-verified below to belong to the same organization AND the same
 * site (the latter enforced both here and, as defense-in-depth, by the
 * database's own same-site relationship-integrity trigger) before use,
 * so accepting it directly from the client is a validated reference,
 * not an unchecked mass-assignment.
 */
export async function recordWebsiteLaunch(rawInput: unknown): Promise<WebsiteSite> {
  const input = parseOrThrow(recordLaunchSchema, rawInput);
  assertFieldsClean({ "Override reason": input.overrideReason ?? null });
  const { context, tenantScope, organizationId } = await resolveWebsiteDevScope("website_development.deploy");

  const { site, siteContext, wasOverride } = await withTenantContext(tenantScope, async (tx) => {
    const siteContext = await loadSiteContext(input.siteId, organizationId, tx);
    const site = await loadWebsiteSiteChecked(input.siteId, organizationId, tx);
    if (site.status === "LAUNCHED") throw new ConflictError("This site is already recorded as launched.");
    // WDEV-SEC-02 (Codex Security Engineer, Build 32) — an ARCHIVED site
    // must return to an active state ONLY through `reactivateWebsiteSite()`
    // (which restores IN_DEVELOPMENT, never LAUNCHED) — this was the one
    // other path capable of moving a site straight from ARCHIVED to
    // LAUNCHED, bypassing that explicit reactivation step entirely.
    if (site.status === "ARCHIVED") throw new ConflictError("This site is archived. Reactivate it before recording a launch.");

    const engagement = await websiteEngagementRepository.findById(site.engagementId, tx);
    const [environments, pageCounts, qaChecks] = await Promise.all([
      websiteEnvironmentRepository.listForSite(input.siteId, tx),
      websitePageRepository.countsForSite(input.siteId, tx),
      engagement?.projectId ? projectQaCheckRepository.listForProject(engagement.projectId, tx) : Promise.resolve([]),
    ]);
    const requiredQa = qaChecks.filter((q) => q.required);
    const passedRequiredQa = requiredQa.filter((q) => q.status === "PASSED" || q.status === "WAIVED");

    const readiness = evaluateLaunchReadiness({
      siteExists: true,
      hasPrimaryDomain: site.primaryUrl !== null,
      hasProductionEnvironment: environments.some((e) => e.type === "PRODUCTION"),
      requiredPageCount: pageCounts.requiredPageCount,
      completedRequiredPageCount: pageCounts.completedRequiredPageCount,
      requiredQaCount: requiredQa.length,
      passedRequiredQaCount: passedRequiredQa.length,
    });

    const wasOverride = readiness.status !== "READY";
    if (wasOverride) {
      if (!input.overrideReason) throw new ValidationError(`This site is not launch-ready: ${readiness.reasons.join(" ")} Provide overrideReason to launch anyway.`);
    }

    if (input.launchDeploymentId) {
      const deployment = await websiteDeploymentRepository.findById(input.launchDeploymentId, tx);
      if (!deployment || deployment.organizationId !== organizationId || deployment.siteId !== input.siteId) throw new NotFoundError("Launch deployment");
    }

    const updated = await websiteSiteRepository.recordLaunch(input.siteId, new Date(), input.launchDeploymentId ?? null, tx);
    if (!updated) throw new ConflictError("This site was just launched by someone else. Reload and try again.");

    // WDEV-SEC-03 (Codex Security Engineer, Build 32) — a readiness
    // OVERRIDE must ALWAYS be durably audited, never left fail-open. Per
    // `audit/service.ts`'s own documented transactional-consistency
    // contract, passing `tx` (and NOT catching the promise here) means an
    // audit-write failure throws and rolls back the launch mutation
    // itself — the launch can never commit without its mandatory
    // override record. The ordinary (non-override) launch keeps this
    // codebase's normal best-effort post-commit audit pattern below,
    // matching every other specialist domain's own convention.
    if (wasOverride) {
      await audit.recordSuccess({
        action: "websitedev.launch_override_recorded",
        organizationId,
        resourceType: "website_site",
        resourceId: updated.id,
        resourceName: updated.name,
        metadata: { overrideReason: input.overrideReason },
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
        tx,
      });
    }

    return { site: updated, siteContext, wasOverride };
  });

  if (!wasOverride) {
    await audit
      .recordSuccess({
        action: "websitedev.launch_recorded",
        organizationId,
        resourceType: "website_site",
        resourceId: site.id,
        resourceName: site.name,
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
      })
      .catch((error) => console.error("[audit] failed to record websitedev.launch_recorded", error));
  }

  if (siteContext.ownerUserId) {
    await events.emit("websitedev.launch_recorded", { siteId: site.id, engagementId: siteContext.engagementId, organizationId, ownerUserId: siteContext.ownerUserId, siteName: site.name, companyName: siteContext.companyName });
  }

  return site;
}
