import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveGhlDevScope } from "./ghl-shared";
import { ghlAssetRepository, type GhlAssetListFilters } from "@/server/repositories/ghl-asset-repository";
import { ghlIntegrationRequirementRepository } from "@/server/repositories/ghl-integration-requirement-repository";
import { ghlImportBatchRepository } from "@/server/repositories/ghl-import-batch-repository";
import { loadGhlWorkspaceChecked } from "./ghl-engagement-service";
import { canTransitionGhlAsset } from "@/lib/ghl/asset-lifecycle";
import { parseGhlAssetCsv, MAX_IMPORT_ROWS } from "@/lib/ghl/csv-import";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { GhlAsset, GhlIntegrationRequirement, GhlAssetImplementationStatus, GhlIntegrationRequirementStatus } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginatedResult, OffsetPaginationParams } from "@/lib/platform/pagination";

/**
 * GHL Automation asset/integration-requirement management (Build 34 —
 * Roadmap Module 28) — implementation assets (funnels/forms/calendars/
 * pipelines/workflows/etc., all through ONE generic typed `GhlAsset`
 * registry — see docs/architecture/ghl-automation-os.md "Asset
 * architecture" for why a single typed table is the smallest correct
 * shape here, never a giant JSON dump and never a bespoke table per
 * asset type) and integration requirements. Reuses
 * `ghl_automation.manage` for every structural mutation (no separate
 * per-asset-type tier — the same reasoning every prior specialist
 * domain's own single `.manage` tier already establishes).
 * `ghl_automation.read` for listing/detail.
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

// --- Assets -----------------------------------------------------------

const createAssetSchema = z.object({
  workspaceId: z.string().uuid(),
  assetType: z.enum(["FUNNEL", "FORM", "SURVEY", "CALENDAR", "PIPELINE", "WORKFLOW", "TRIGGER", "CUSTOM_FIELD", "EMAIL_TEMPLATE", "SMS_TEMPLATE", "SNAPSHOT", "OTHER"]),
  name: z.string().trim().min(1).max(200),
  externalAssetId: z.string().trim().max(200).nullable().optional(),
  requiredForLaunch: z.boolean().default(true),
  customerVisible: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export async function createGhlAsset(rawInput: unknown): Promise<GhlAsset> {
  const input = parseOrThrow(createAssetSchema, rawInput);
  // Every persisted free-text field is screened from the start (Build
  // 33's own ECOM-SEC-01 finding, applied proactively here).
  assertFieldsClean({ "Asset name": input.name, "External asset ID": input.externalAssetId ?? null, Notes: input.notes ?? null });
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const asset = await withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    if (input.externalAssetId) {
      const existing = await ghlAssetRepository.findByExternalAssetId(input.workspaceId, input.externalAssetId, tx);
      if (existing) throw new ConflictError(`"${input.externalAssetId}" is already tracked as an asset identifier on this workspace.`);
    }

    return ghlAssetRepository.create(
      {
        id: generateId(),
        organizationId,
        workspaceId: input.workspaceId,
        assetType: input.assetType,
        name: input.name,
        externalAssetId: input.externalAssetId ?? null,
        source: "MANUAL",
        requiredForLaunch: input.requiredForLaunch,
        customerVisible: input.customerVisible,
        sortOrder: input.sortOrder,
        notes: input.notes ?? null,
        importBatchId: null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "ghl.asset_created", organizationId, resourceType: "ghl_asset", resourceId: asset.id, resourceName: asset.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.asset_created", error));
  return asset;
}

const assetIdSchema = z.object({ assetId: z.string().uuid() });

async function loadGhlAssetChecked(assetId: string, organizationId: string, tx: TransactionClient): Promise<GhlAsset> {
  const asset = await ghlAssetRepository.findById(assetId, tx);
  if (!asset || asset.organizationId !== organizationId) throw new NotFoundError("GHL asset");
  return asset;
}

export async function getGhlAsset(rawInput: unknown): Promise<GhlAsset> {
  const input = parseOrThrow(assetIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  return withTenantContext(tenantScope, (tx) => loadGhlAssetChecked(input.assetId, organizationId, tx));
}

const listAssetsSchema = z.object({
  workspaceId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  assetType: z.enum(["FUNNEL", "FORM", "SURVEY", "CALENDAR", "PIPELINE", "WORKFLOW", "TRIGGER", "CUSTOM_FIELD", "EMAIL_TEMPLATE", "SMS_TEMPLATE", "SNAPSHOT", "OTHER"]).optional(),
  implementationStatus: z.enum(["PLANNED", "IN_PROGRESS", "READY_FOR_QA", "QA_FAILED", "READY", "LIVE", "ARCHIVED"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export async function listGhlAssets(rawInput: unknown): Promise<OffsetPaginatedResult<GhlAsset>> {
  const input = parseOrThrow(listAssetsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: GhlAssetListFilters = { assetType: input.assetType, implementationStatus: input.implementationStatus, search: input.search };
  return withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    return ghlAssetRepository.listForWorkspace(input.workspaceId, params, filters, tx);
  });
}

const transitionAssetSchema = z.object({ assetId: z.string().uuid(), status: z.enum(["PLANNED", "IN_PROGRESS", "READY_FOR_QA", "QA_FAILED", "READY", "LIVE", "ARCHIVED"]) });

export async function transitionGhlAssetStatus(rawInput: unknown): Promise<GhlAsset> {
  const input = parseOrThrow(transitionAssetSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");
  const asset = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadGhlAssetChecked(input.assetId, organizationId, tx);
    if (!canTransitionGhlAsset(existing.implementationStatus as GhlAssetImplementationStatus, input.status)) throw new ValidationError(`Cannot move a ${existing.implementationStatus} asset to ${input.status}.`);
    const updated = await ghlAssetRepository.transition(input.assetId, existing.implementationStatus, input.status, tx);
    if (!updated) throw new ConflictError("This asset was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "ghl.asset_status_changed", organizationId, resourceType: "ghl_asset", resourceId: asset.id, resourceName: asset.name, metadata: { status: asset.implementationStatus }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.asset_status_changed", error));
  return asset;
}

// --- Integration requirements ----------------------------------------------

const createIntegrationRequirementSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  required: z.boolean().default(true),
  externalSystemLabel: z.string().trim().max(200).nullable().optional(),
  customerVisible: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function createGhlIntegrationRequirement(rawInput: unknown): Promise<GhlIntegrationRequirement> {
  const input = parseOrThrow(createIntegrationRequirementSchema, rawInput);
  assertFieldsClean({ Name: input.name, "External system label": input.externalSystemLabel ?? null, Notes: input.notes ?? null });
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const requirement = await withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    return ghlIntegrationRequirementRepository.create(
      { id: generateId(), organizationId, workspaceId: input.workspaceId, name: input.name, required: input.required, externalSystemLabel: input.externalSystemLabel ?? null, customerVisible: input.customerVisible, notes: input.notes ?? null, createdByUserId: context.user!.id },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "ghl.integration_requirement_created", organizationId, resourceType: "ghl_integration_requirement", resourceId: requirement.id, resourceName: requirement.name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record ghl.integration_requirement_created", error));
  return requirement;
}

const listIntegrationRequirementsSchema = z.object({ workspaceId: z.string().uuid() });

export async function listGhlIntegrationRequirements(rawInput: unknown): Promise<GhlIntegrationRequirement[]> {
  const input = parseOrThrow(listIntegrationRequirementsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    return ghlIntegrationRequirementRepository.listForWorkspace(input.workspaceId, tx);
  });
}

const updateIntegrationRequirementStatusSchema = z.object({ integrationRequirementId: z.string().uuid(), status: z.enum(["NOT_CONFIGURED", "CONFIGURED", "CONFIRMED"]) });

export async function updateGhlIntegrationRequirementStatus(rawInput: unknown): Promise<GhlIntegrationRequirement> {
  const input = parseOrThrow(updateIntegrationRequirementStatusSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");
  const requirement = await withTenantContext(tenantScope, async (tx) => {
    const existing = await ghlIntegrationRequirementRepository.findById(input.integrationRequirementId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("GHL integration requirement");
    return ghlIntegrationRequirementRepository.updateStatus(input.integrationRequirementId, input.status as GhlIntegrationRequirementStatus, tx);
  });
  await audit
    .recordSuccess({
      action: "ghl.integration_requirement_status_changed",
      organizationId,
      resourceType: "ghl_integration_requirement",
      resourceId: requirement.id,
      resourceName: requirement.name,
      metadata: { status: requirement.status },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ghl.integration_requirement_status_changed", error));
  return requirement;
}

// --- CSV import -----------------------------------------------------------

const importCsvSchema = z.object({
  workspaceId: z.string().uuid(),
  fileContent: z.string().max(5_000_000),
});

export interface GhlAssetImportResult {
  totalRowCount: number;
  importedRowCount: number;
  skippedRowCount: number;
  skippedReasons: { rowNumber: number; reason: string }[];
}

/**
 * Manual CSV asset import. Applies Build 33's own Codex-found lessons
 * from the start rather than discovering them as Build-34 findings:
 *   - ECOM-SEC-05: the row-count limit is checked from a cheap line
 *     count BEFORE the full field-parsing pass runs.
 *   - ECOM-SEC-01: every CSV-derived free-text field (name/notes) is
 *     screened for credential-shaped content — a row tripping the guard
 *     is skipped with a reason, never silently imported, never aborts
 *     the whole batch.
 *   - ECOM-SEC-03/PERF-ECOM-05: the existing-externalAssetId dedup query
 *     is scoped to exactly the incoming file's own values
 *     (`externalAssetId: { in: [...] }`, at most `MAX_IMPORT_ROWS`) —
 *     exact AND bounded, never a whole-workspace prefetch.
 *   - PERF-ECOM-01: rows are inserted via ONE `createMany()` batch write
 *     (no variant-equivalent second table here), not up to 500 serial
 *     single-row `create()` calls.
 *   - Build 30's own FK-ordering lesson: the `GhlImportBatch` parent row
 *     is created BEFORE any asset row references it, in the same
 *     transaction.
 */
export async function importGhlAssetCsv(rawInput: unknown): Promise<GhlAssetImportResult> {
  const input = parseOrThrow(importCsvSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.manage");

  const lineCount = input.fileContent.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
  if (lineCount - 1 > MAX_IMPORT_ROWS) throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);

  const parsed = parseGhlAssetCsv(input.fileContent);
  if (parsed.totalDataRowCount > MAX_IMPORT_ROWS) throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);

  const { batch, skippedReasons } = await withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);

    const skippedReasons: { rowNumber: number; reason: string }[] = parsed.rejected.map((r) => ({ rowNumber: r.rowNumber, reason: r.reason }));
    const toInsert: (typeof parsed.rows)[number][] = [];
    const seenExternalIds = new Set<string>();

    const incomingExternalIds = new Set(parsed.rows.map((r) => r.externalAssetId).filter((id): id is string => id !== null));
    const existingAssetRows = incomingExternalIds.size > 0 ? await tx.ghlAsset.findMany({ where: { workspaceId: input.workspaceId, externalAssetId: { in: [...incomingExternalIds] } }, select: { externalAssetId: true } }) : [];
    const existingExternalIds = new Set(existingAssetRows.map((a) => a.externalAssetId).filter((id): id is string => id !== null));

    for (const row of parsed.rows) {
      try {
        // Codex Security Engineer finding GHL-SEC-02 — `externalAssetId`
        // is persisted free text exactly like `name`/`notes` and must be
        // screened identically; the direct-create path (`createGhlAsset`
        // above) already screens it, and CSV import must not be a weaker
        // path into the same column.
        assertFieldsClean({ "CSV name": row.name, "CSV external asset ID": row.externalAssetId, "CSV notes": row.notes });
      } catch (error) {
        if (error instanceof ValidationError) {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: error.message });
          continue;
        }
        throw error;
      }

      if (row.externalAssetId) {
        if (existingExternalIds.has(row.externalAssetId) || seenExternalIds.has(row.externalAssetId)) {
          skippedReasons.push({ rowNumber: row.rowNumber, reason: `externalAssetId "${row.externalAssetId}" already exists on this workspace or is duplicated within this file` });
          continue;
        }
        seenExternalIds.add(row.externalAssetId);
      }

      toInsert.push(row);
    }

    // The batch parent is created BEFORE any asset row references it.
    const batch = await ghlImportBatchRepository.create(
      { id: generateId(), organizationId, workspaceId: input.workspaceId, importedByUserId: context.user!.id, totalRowCount: parsed.totalDataRowCount, importedRowCount: toInsert.length, skippedRowCount: parsed.totalDataRowCount - toInsert.length },
      tx,
    );

    const assetRows = toInsert.map((row) => ({
      id: generateId(),
      organizationId,
      workspaceId: input.workspaceId,
      assetType: row.assetType,
      name: row.name,
      externalAssetId: row.externalAssetId,
      implementationStatus: row.implementationStatus,
      source: "IMPORT" as const,
      requiredForLaunch: row.requiredForLaunch,
      customerVisible: false,
      sortOrder: 0,
      notes: row.notes,
      importBatchId: batch.id,
      createdByUserId: context.user!.id,
    }));

    if (assetRows.length > 0) await tx.ghlAsset.createMany({ data: assetRows });

    return { batch, skippedReasons };
  });

  await audit
    .recordSuccess({
      action: "ghl.import_recorded",
      organizationId,
      resourceType: "ghl_import_batch",
      resourceId: batch.id,
      resourceName: `Import — ${batch.importedRowCount}/${batch.totalRowCount} rows`,
      metadata: { totalRowCount: batch.totalRowCount, importedRowCount: batch.importedRowCount, skippedRowCount: batch.skippedRowCount },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ghl.import_recorded", error));

  return { totalRowCount: batch.totalRowCount, importedRowCount: batch.importedRowCount, skippedRowCount: batch.skippedRowCount, skippedReasons };
}

const listImportBatchesSchema = z.object({ workspaceId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function listGhlImportBatches(rawInput: unknown) {
  const input = parseOrThrow(listImportBatchesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveGhlDevScope("ghl_automation.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadGhlWorkspaceChecked(input.workspaceId, organizationId, tx);
    return ghlImportBatchRepository.listForWorkspace(input.workspaceId, input.limit, tx);
  });
}
