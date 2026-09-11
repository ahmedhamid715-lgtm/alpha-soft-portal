import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveSeoScope } from "./seo-shared";
import { seoPropertyRepository } from "@/server/repositories/seo-property-repository";
import { seoKeywordRepository } from "@/server/repositories/seo-keyword-repository";
import { seoRankObservationRepository, type SeoRankObservationCreateInput } from "@/server/repositories/seo-rank-observation-repository";
import { seoImportBatchRepository } from "@/server/repositories/seo-import-batch-repository";
import { seoAuditRunRepository } from "@/server/repositories/seo-audit-run-repository";
import { seoIssueRepository } from "@/server/repositories/seo-issue-repository";
import { seoEngagementRepository } from "@/server/repositories/seo-engagement-repository";
import { createInternalTask, cancelInternalTask } from "./tasks/internal-task-service";
import { urlBelongsToOrigin } from "@/lib/seo/property-url";
import { normalizeKeywordPhrase } from "@/lib/seo/keyword-normalization";
import { parseRankObservationCsv, MAX_IMPORT_ROWS } from "@/lib/seo/csv-import";
import { canTransitionSeoIssue } from "@/lib/seo/issue-lifecycle";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { SeoRankObservation, SeoAuditRun, SeoIssue, SeoDevice } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * SEO OS measurement recording (Build 30 — Roadmap Module 24) — rank
 * observations, technical audit runs, and issue lifecycle. `seo.
 * measurements.manage` for recording observations/audits/imports (a
 * narrower tier than `seo.manage` — see permissions.ts); issue
 * ACKNOWLEDGE/RESOLVE/IGNORE/reopen reuse the same permission (day-to-
 * day operational triage, not structural engagement management).
 */

interface PropertyContext {
  propertyId: string;
  engagementId: string;
  customerServiceId: string;
  ownerUserId: string | null;
  companyName: string;
  propertyDisplayUrl: string;
  propertyNormalizedOrigin: string;
}

async function loadPropertyContext(propertyId: string, organizationId: string, tx: TransactionClient): Promise<PropertyContext> {
  const property = await seoPropertyRepository.findById(propertyId, tx);
  if (!property || property.organizationId !== organizationId) throw new NotFoundError("SEO property");
  const engagement = await seoEngagementRepository.findById(property.engagementId, tx);
  if (!engagement) throw new NotFoundError("SEO engagement");
  const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, ownerUserId: true } });
  const company = customerService ? await tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : null;
  return {
    propertyId,
    engagementId: engagement.id,
    customerServiceId: engagement.customerServiceId,
    ownerUserId: customerService?.ownerUserId ?? null,
    companyName: company?.name ?? "Customer",
    propertyDisplayUrl: property.displayUrl,
    propertyNormalizedOrigin: property.normalizedOrigin,
  };
}

/**
 * Build 30 Codex Security Engineer finding SEO-SEC-01 — an issue's
 * `pageUrl` was accepted verbatim without confirming it actually
 * belongs to the property it's attached to, unlike a keyword's own
 * `targetUrl` (`createSeoKeyword()` already enforces this). A foreign-
 * origin page URL would corrupt the dedup key and, if this field is
 * ever rendered as a clickable link in a future build, would be a real
 * risk. Shared by both issue-creation paths (manual entry, audit-run
 * recording) so neither can diverge again.
 */
function assertPageUrlBelongsToProperty(pageUrl: string | null, ctx: Pick<PropertyContext, "propertyNormalizedOrigin">): void {
  if (pageUrl && !urlBelongsToOrigin(pageUrl, ctx.propertyNormalizedOrigin)) {
    throw new ValidationError(`pageUrl must be on ${ctx.propertyNormalizedOrigin} — this issue's own property.`);
  }
}

async function notifyCriticalIssue(issue: SeoIssue, ctx: PropertyContext, organizationId: string): Promise<void> {
  if (issue.severity !== "CRITICAL" || issue.status !== "OPEN" || !ctx.ownerUserId) return;
  await events.emit("seo.critical_issue_detected", { issueId: issue.id, engagementId: ctx.engagementId, organizationId, ownerUserId: ctx.ownerUserId, propertyDisplayUrl: ctx.propertyDisplayUrl, issueTitle: issue.title, companyName: ctx.companyName });
}

// --- Rank observations (manual) --------------------------------------------

const recordObservationSchema = z.object({
  keywordId: z.string().uuid(),
  observedAt: z.coerce.date(),
  rankStatus: z.enum(["RANKED", "NOT_FOUND", "BEYOND_TRACKED_RANGE", "SOURCE_ERROR"]),
  position: z.coerce.number().int().positive().nullable().optional(),
  rankingUrl: z.string().url().max(2048).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function recordRankObservation(rawInput: unknown): Promise<SeoRankObservation> {
  const input = parseOrThrow(recordObservationSchema, rawInput);
  if (input.rankStatus === "RANKED" && !input.position) throw new ValidationError("position is required when rankStatus is RANKED.");
  if (input.rankStatus !== "RANKED" && input.position) throw new ValidationError("position must be omitted unless rankStatus is RANKED.");

  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");

  const observation = await withTenantContext(tenantScope, async (tx) => {
    const keyword = await seoKeywordRepository.findById(input.keywordId, tx);
    if (!keyword || keyword.organizationId !== organizationId) throw new NotFoundError("SEO keyword");
    const alreadyExists = await seoRankObservationRepository.existsForKeywordAndDate(input.keywordId, input.observedAt, tx);
    if (alreadyExists) throw new ConflictError("An observation already exists for this keyword on this date.");

    return seoRankObservationRepository.create(
      { id: generateId(), organizationId, keywordId: input.keywordId, observedAt: input.observedAt, source: "MANUAL", rankStatus: input.rankStatus, position: input.position ?? null, rankingUrl: input.rankingUrl ?? null, notes: input.notes ?? null, importBatchId: null, createdByUserId: context.user!.id },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "seo.rank_observation_recorded", organizationId, resourceType: "seo_rank_observation", resourceId: observation.id, resourceName: `Observation ${observation.observedAt.toISOString().slice(0, 10)}`, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.rank_observation_recorded", error));
  return observation;
}

// --- Rank observations (CSV import) -----------------------------------------

const importSchema = z.object({
  propertyId: z.string().uuid(),
  device: z.enum(["DESKTOP", "MOBILE"]),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  locale: z.string().min(2).max(35).nullable().optional(),
  fileName: z.string().max(200).nullable().optional(),
  fileContent: z.string().min(1).max(2_000_000),
});

export interface ImportRankObservationsResult {
  batchId: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  skippedReasons: { rowNumber: number; reason: string }[];
}

/**
 * Bulk-loads rank observations for ALREADY-TRACKED keywords only —
 * never auto-creates a keyword (same "no fuzzy auto-mapping" discipline
 * Service Management's own unmapped-onboarding-items flow establishes).
 * A row whose phrase doesn't match an existing keyword (for this
 * property + device + country + locale) is skipped with a specific
 * reason, never silently guessed.
 */
export async function importRankObservations(rawInput: unknown): Promise<ImportRankObservationsResult> {
  const input = parseOrThrow(importSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");
  const parsed = parseRankObservationCsv(input.fileContent);
  // Build 30 Codex Security Engineer finding SEO-SEC-02 — checked
  // against the file's REAL row count (`totalDataRowCount`, computed
  // before the parser's own internal work-bounding slice), not the
  // post-slice `rows.length + rejected.length` — an over-limit file is
  // now actually rejected outright instead of silently processing only
  // its first 500 rows while claiming success.
  if (parsed.totalDataRowCount > MAX_IMPORT_ROWS) throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);
  const rowCount = parsed.totalDataRowCount;

  const result = await withTenantContext(tenantScope, async (tx) => {
    const property = await seoPropertyRepository.findById(input.propertyId, tx);
    if (!property || property.organizationId !== organizationId) throw new NotFoundError("SEO property");

    const skippedReasons: { rowNumber: number; reason: string }[] = parsed.rejected.map((r) => ({ rowNumber: r.rowNumber, reason: r.reason }));
    const toInsert: SeoRankObservationCreateInput[] = [];
    const seenInBatch = new Set<string>();
    const device: SeoDevice = input.device;
    const country = input.country ?? null;
    const locale = input.locale ?? null;

    // Build 30 Codex Performance Engineer finding P2 — prefetch every
    // ACTIVE keyword for this property ONCE (bounded, same 500-cap
    // `listActiveForProperty()` already documents) and match rows
    // in-memory, rather than one `findByDedupKey()` round trip per CSV
    // row (up to 500 sequential queries inside one transaction).
    const activeKeywords = await seoKeywordRepository.listActiveForProperty(input.propertyId, tx);
    const keywordByDedupKey = new Map(activeKeywords.filter((k) => k.searchEngine === "GOOGLE" && k.device === device && k.country === country && k.locale === locale).map((k) => [k.normalizedPhrase, k]));

    for (const row of parsed.rows) {
      const normalizedPhrase = normalizeKeywordPhrase(row.phrase);
      const keyword = keywordByDedupKey.get(normalizedPhrase);
      if (!keyword) {
        skippedReasons.push({ rowNumber: row.rowNumber, reason: `No tracked keyword matches "${row.phrase}" for this property/device/location — add it first.` });
        continue;
      }
      const dedupKey = `${keyword.id}:${row.observedAt.toISOString()}`;
      if (seenInBatch.has(dedupKey)) {
        skippedReasons.push({ rowNumber: row.rowNumber, reason: "Duplicate keyword+date within this same file." });
        continue;
      }
      seenInBatch.add(dedupKey);
      toInsert.push({ id: generateId(), organizationId, keywordId: keyword.id, observedAt: row.observedAt, source: "IMPORT", rankStatus: row.rankStatus, position: row.position, rankingUrl: row.rankingUrl, notes: row.notes, importBatchId: null, createdByUserId: context.user!.id });
    }

    // The batch row must exist BEFORE the observations that reference
    // it by FK — created here with provisional (0) counts, then
    // finalized with the real counts once the insert has actually run
    // (its real result — including any cross-request `skipDuplicates`
    // races — is only known after).
    const batchId = generateId();
    const provisionalBatch = await seoImportBatchRepository.create({ id: batchId, organizationId, engagementId: property.engagementId, fileName: input.fileName ?? null, rowCount, importedCount: 0, skippedCount: 0, createdByUserId: context.user!.id }, tx);

    // `skipDuplicates` in the repository's `createMany()` handles a
    // cross-request race (the same keyword+date inserted between our
    // own read above and this write) — the returned count may be lower
    // than `toInsert.length` in that case, and that difference is
    // honestly reported as skipped rather than silently absorbed.
    const insertedWithBatch = toInsert.map((row) => ({ ...row, importBatchId: batchId }));
    const importedCount = await seoRankObservationRepository.createMany(insertedWithBatch, tx);
    const skippedCount = rowCount - importedCount;

    const batch = await seoImportBatchRepository.finalizeCounts(provisionalBatch.id, importedCount, skippedCount, tx);
    return { batch, importedCount, skippedCount, skippedReasons };
  });

  await audit
    .recordSuccess({
      action: "seo.rank_observations_imported",
      organizationId,
      resourceType: "seo_import_batch",
      resourceId: result.batch.id,
      resourceName: input.fileName ?? "Rank import",
      metadata: { rowCount, importedCount: result.importedCount, skippedCount: result.skippedCount },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record seo.rank_observations_imported", error));

  return { batchId: result.batch.id, rowCount, importedCount: result.importedCount, skippedCount: result.skippedCount, skippedReasons: result.skippedReasons };
}

// --- Technical audits + issues ----------------------------------------------

const auditIssueInputSchema = z.object({
  issueType: z.enum(["BROKEN_LINK", "MISSING_TITLE", "MISSING_META_DESCRIPTION", "DUPLICATE_TITLE", "DUPLICATE_META_DESCRIPTION", "MISSING_H1", "SLOW_PAGE_SPEED", "MISSING_ALT_TEXT", "REDIRECT_CHAIN", "NOINDEX_CONFLICT", "THIN_CONTENT", "MOBILE_USABILITY", "OTHER"]),
  severity: z.enum(["CRITICAL", "WARNING", "INFO"]),
  pageUrl: z.string().url().max(2048).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).nullable().optional(),
});

const recordAuditRunSchema = z.object({
  propertyId: z.string().uuid(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  issues: z.array(auditIssueInputSchema).max(100).default([]),
});

export interface RecordAuditRunResult {
  auditRun: SeoAuditRun;
  createdIssueCount: number;
  reconfirmedIssueCount: number;
  reopenedIssueCount: number;
}

/**
 * Records a technical audit event (MANUAL only — no crawler exists,
 * see docs/architecture/seo-os.md "Background processing"), plus every
 * issue staff observed during it. Each issue is deduped against the
 * property's own existing issues by (issueType, pageUrl): a genuinely
 * new condition is created; an already-OPEN/ACKNOWLEDGED one is
 * reconfirmed (lastDetectedAt bumped only); an already-RESOLVED/IGNORED
 * one that recurred is REOPENED — one continuous history per condition,
 * never a duplicate row.
 */
export async function recordSeoAuditRun(rawInput: unknown): Promise<RecordAuditRunResult> {
  const input = parseOrThrow(recordAuditRunSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");

  const { auditRun, createdIssueCount, reconfirmedIssueCount, reopenedIssueCount, newlyOpenCriticalIssues, propertyContext } = await withTenantContext(tenantScope, async (tx) => {
    const propertyContext = await loadPropertyContext(input.propertyId, organizationId, tx);
    const startedAt = input.startedAt;
    const completedAt = input.completedAt ?? startedAt;

    const auditRun = await seoAuditRunRepository.create({ id: generateId(), organizationId, propertyId: input.propertyId, source: "MANUAL", status: "COMPLETED", startedAt, completedAt, summary: input.summary ?? null, createdByUserId: context.user!.id }, tx);

    let createdIssueCount = 0;
    let reconfirmedIssueCount = 0;
    let reopenedIssueCount = 0;
    const newlyOpenCriticalIssues: SeoIssue[] = [];

    // Build 30 Codex Performance Engineer finding P5 — the same
    // sequential-lookup N+1 as the CSV import path (P2), for the audit
    // run's own up-to-100 issue entries. Prefetch every existing issue
    // matching one of this audit's (issueType, pageUrl) dedup keys in a
    // SINGLE query, then look up in-memory — writes stay per-issue
    // (create/reopen/reconfirm each have different transition rules and
    // CAS guarantees that shouldn't be collapsed into one batch write).
    const existingIssues =
      input.issues.length > 0
        ? await tx.seoIssue.findMany({ where: { propertyId: input.propertyId, OR: input.issues.map((i) => ({ issueType: i.issueType, pageUrl: i.pageUrl ?? null })) } })
        : [];
    const existingByDedupKey = new Map(existingIssues.map((i) => [`${i.issueType}:${i.pageUrl ?? ""}`, i]));

    for (const issueInput of input.issues) {
      const pageUrl = issueInput.pageUrl ?? null;
      assertPageUrlBelongsToProperty(pageUrl, propertyContext);
      const existing = existingByDedupKey.get(`${issueInput.issueType}:${pageUrl ?? ""}`) ?? null;
      if (!existing) {
        const created = await seoIssueRepository.create(
          {
            id: generateId(),
            organizationId,
            propertyId: input.propertyId,
            issueType: issueInput.issueType,
            severity: issueInput.severity,
            pageUrl,
            title: issueInput.title,
            description: issueInput.description ?? null,
            detectedByAuditRunId: auditRun.id,
            firstDetectedAt: completedAt,
            lastDetectedAt: completedAt,
            createdByUserId: context.user!.id,
          },
          tx,
        );
        createdIssueCount++;
        if (created.severity === "CRITICAL") newlyOpenCriticalIssues.push(created);
      } else if (existing.status === "RESOLVED" || existing.status === "IGNORED") {
        const reopened = await seoIssueRepository.reopen(existing.id, completedAt, auditRun.id, tx);
        if (reopened) {
          reopenedIssueCount++;
          if (reopened.severity === "CRITICAL") newlyOpenCriticalIssues.push(reopened);
        }
      } else {
        await seoIssueRepository.reconfirm(existing.id, completedAt, auditRun.id, tx);
        reconfirmedIssueCount++;
      }
    }

    return { auditRun, createdIssueCount, reconfirmedIssueCount, reopenedIssueCount, newlyOpenCriticalIssues, propertyContext };
  });

  await audit
    .recordSuccess({
      action: "seo.audit_run_recorded",
      organizationId,
      resourceType: "seo_audit_run",
      resourceId: auditRun.id,
      resourceName: propertyContext.propertyDisplayUrl,
      metadata: { createdIssueCount, reconfirmedIssueCount, reopenedIssueCount },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record seo.audit_run_recorded", error));

  for (const issue of newlyOpenCriticalIssues) await notifyCriticalIssue(issue, propertyContext, organizationId);

  return { auditRun, createdIssueCount, reconfirmedIssueCount, reopenedIssueCount };
}

// --- Manual issue entry (no audit run) --------------------------------------

const createIssueManuallySchema = z.object({ propertyId: z.string().uuid(), ...auditIssueInputSchema.shape });

export async function createSeoIssueManually(rawInput: unknown): Promise<SeoIssue> {
  const input = parseOrThrow(createIssueManuallySchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");
  const pageUrl = input.pageUrl ?? null;

  const { issue, propertyContext, wasReopened } = await withTenantContext(tenantScope, async (tx) => {
    const propertyContext = await loadPropertyContext(input.propertyId, organizationId, tx);
    assertPageUrlBelongsToProperty(pageUrl, propertyContext);
    const now = new Date();
    const existing = await seoIssueRepository.findByDedupKey(input.propertyId, input.issueType, pageUrl, tx);
    if (existing && (existing.status === "OPEN" || existing.status === "ACKNOWLEDGED")) {
      throw new ConflictError("This issue is already open for this property/page.");
    }
    if (existing) {
      const reopened = await seoIssueRepository.reopen(existing.id, now, null, tx);
      if (!reopened) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
      return { issue: reopened, propertyContext, wasReopened: true };
    }
    const created = await seoIssueRepository.create(
      { id: generateId(), organizationId, propertyId: input.propertyId, issueType: input.issueType, severity: input.severity, pageUrl, title: input.title, description: input.description ?? null, detectedByAuditRunId: null, firstDetectedAt: now, lastDetectedAt: now, createdByUserId: context.user!.id },
      tx,
    );
    return { issue: created, propertyContext, wasReopened: false };
  });

  await audit
    .recordSuccess({ action: "seo.issue_created", organizationId, resourceType: "seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.issue_created", error));
  if (wasReopened) {
    await audit
      .recordSuccess({ action: "seo.issue_reopened", organizationId, resourceType: "seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record seo.issue_reopened", error));
  }
  await notifyCriticalIssue(issue, propertyContext, organizationId);
  return issue;
}

// --- Issue lifecycle ----------------------------------------------------

const issueIdSchema = z.object({ issueId: z.string().uuid() });

async function loadIssueLocked(issueId: string, organizationId: string, tx: TransactionClient): Promise<SeoIssue> {
  const issue = await seoIssueRepository.findByIdLocked(issueId, tx);
  if (!issue || issue.organizationId !== organizationId) throw new NotFoundError("SEO issue");
  return issue;
}

export async function acknowledgeSeoIssue(rawInput: unknown): Promise<SeoIssue> {
  const input = parseOrThrow(issueIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");
  const issue = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionSeoIssue(existing.status, "ACKNOWLEDGED")) throw new ValidationError(`Cannot acknowledge a ${existing.status} issue.`);
    const updated = await seoIssueRepository.acknowledge(input.issueId, context.user!.id, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.issue_acknowledged", organizationId, resourceType: "seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.issue_acknowledged", error));
  return issue;
}

const resolveIssueSchema = z.object({ issueId: z.string().uuid(), resolutionNotes: z.string().trim().max(1000).nullable().optional() });

export async function resolveSeoIssue(rawInput: unknown): Promise<SeoIssue> {
  const input = parseOrThrow(resolveIssueSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");
  const issue = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionSeoIssue(existing.status, "RESOLVED")) throw new ValidationError(`Cannot resolve a ${existing.status} issue.`);
    const updated = await seoIssueRepository.resolve(input.issueId, context.user!.id, input.resolutionNotes ?? null, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.issue_resolved", organizationId, resourceType: "seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.issue_resolved", error));
  return issue;
}

const ignoreIssueSchema = z.object({ issueId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function ignoreSeoIssue(rawInput: unknown): Promise<SeoIssue> {
  const input = parseOrThrow(ignoreIssueSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");
  const issue = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionSeoIssue(existing.status, "IGNORED")) throw new ValidationError(`Cannot ignore a ${existing.status} issue.`);
    const updated = await seoIssueRepository.ignore(input.issueId, context.user!.id, input.reason, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.issue_ignored", organizationId, resourceType: "seo_issue", resourceId: issue.id, resourceName: issue.title, metadata: { reason: input.reason }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.issue_ignored", error));
  return issue;
}

export async function reopenSeoIssue(rawInput: unknown): Promise<SeoIssue> {
  const input = parseOrThrow(issueIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");
  const { issue, propertyContext } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionSeoIssue(existing.status, "OPEN")) throw new ValidationError(`Cannot reopen a ${existing.status} issue.`);
    const updated = await seoIssueRepository.reopen(input.issueId, new Date(), null, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    const propertyContext = await loadPropertyContext(updated.propertyId, organizationId, tx);
    return { issue: updated, propertyContext };
  });
  await audit
    .recordSuccess({ action: "seo.issue_reopened", organizationId, resourceType: "seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.issue_reopened", error));
  await notifyCriticalIssue(issue, propertyContext, organizationId);
  return issue;
}

/**
 * Converts an issue into a real, trackable `InternalTask` via Task
 * Management's own creation API — never inserts a task row directly,
 * never a duplicate task system.
 *
 * Build 30 Codex Security Engineer finding SEO-SEC-05 — the issue's
 * row lock is released before `createInternalTask()` runs (a genuine
 * cross-service call spanning two transactions), so two concurrent
 * calls could both observe "not yet linked" and each create a real
 * task. The final link write is CAS-guarded
 * (`linkedTaskId IS NULL`); a lost race cancels the just-created,
 * now-orphaned task rather than leaving it dangling with no issue
 * pointing back at it.
 */
export async function linkSeoIssueToTask(rawInput: unknown): Promise<SeoIssue> {
  const input = parseOrThrow(issueIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.measurements.manage");

  const issue = await withTenantContext(tenantScope, (tx) => loadIssueLocked(input.issueId, organizationId, tx));
  if (issue.linkedTaskId) throw new ValidationError("This issue is already linked to a task.");

  const task = await createInternalTask({ title: `SEO issue: ${issue.title}`, description: issue.description ?? undefined, priority: issue.severity === "CRITICAL" ? "HIGH" : "MEDIUM" });

  const linked = await withTenantContext(tenantScope, (tx) => seoIssueRepository.linkTask(input.issueId, task.id, tx));
  if (!linked) {
    await cancelInternalTask({ taskId: task.id, reason: "Superseded by a concurrent link to the same SEO issue." }).catch((error) => console.error("[seo] failed to cancel orphaned task after a lost linkSeoIssueToTask race", error));
    throw new ConflictError("This issue was just linked to a task by someone else. Reload and try again.");
  }

  await audit
    .recordSuccess({ action: "seo.issue_linked_to_task", organizationId, resourceType: "seo_issue", resourceId: linked.id, resourceName: linked.title, metadata: { taskId: task.id }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.issue_linked_to_task", error));
  return linked;
}

const listIssuesSchema = z.object({
  propertyId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"]).optional(),
  severity: z.enum(["CRITICAL", "WARNING", "INFO"]).optional(),
});

export async function listSeoIssues(rawInput: unknown) {
  const input = parseOrThrow(listIssuesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const property = await seoPropertyRepository.findById(input.propertyId, tx);
    if (!property || property.organizationId !== organizationId) throw new NotFoundError("SEO property");
    return seoIssueRepository.listForProperty(input.propertyId, { page: input.page, limit: input.limit }, { status: input.status, severity: input.severity }, tx);
  });
}

const listAuditRunsSchema = z.object({ propertyId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export async function listSeoAuditRuns(rawInput: unknown): Promise<SeoAuditRun[]> {
  const input = parseOrThrow(listAuditRunsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const property = await seoPropertyRepository.findById(input.propertyId, tx);
    if (!property || property.organizationId !== organizationId) throw new NotFoundError("SEO property");
    return seoAuditRunRepository.listForProperty(input.propertyId, input.limit, tx);
  });
}
