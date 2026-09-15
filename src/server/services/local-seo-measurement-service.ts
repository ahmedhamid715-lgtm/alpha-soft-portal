import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveLocalSeoScope } from "./local-seo-shared";
import { localSeoLocationRepository } from "@/server/repositories/local-seo-location-repository";
import { localSeoKeywordRepository } from "@/server/repositories/local-seo-keyword-repository";
import { localRankObservationRepository, type LocalRankObservationCreateInput } from "@/server/repositories/local-rank-observation-repository";
import { localSeoImportBatchRepository } from "@/server/repositories/local-seo-import-batch-repository";
import { localListingRepository } from "@/server/repositories/local-listing-repository";
import { localReviewRepository } from "@/server/repositories/local-review-repository";
import { localSeoAuditRunRepository } from "@/server/repositories/local-seo-audit-run-repository";
import { localSeoIssueRepository } from "@/server/repositories/local-seo-issue-repository";
import { localSeoEngagementRepository } from "@/server/repositories/local-seo-engagement-repository";
import { createInternalTask, cancelInternalTask } from "./tasks/internal-task-service";
import { normalizeKeywordPhrase } from "@/lib/seo/keyword-normalization";
import { parseLocalRankObservationCsv, MAX_IMPORT_ROWS } from "@/lib/local-seo/csv-import";
import { canTransitionLocalSeoIssue } from "@/lib/local-seo/issue-lifecycle";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { LocalRankObservation, LocalSeoAuditRun, LocalSeoIssue, LocalListing, LocalReview, LocalSeoDevice } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/** Same http/https-only enforcement `local-seo-engagement-service.ts`'s own `isHttpUrl()` applies — Codex Security Engineer finding LS-SEC-03 (Build 31 security review) flagged the same scheme-permissive gap on listing URL fields, rendered as JSX text today but normalized now so a future link sink never inherits it. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Local SEO / GBP measurement recording (Build 31 — Roadmap Module 25) —
 * local rank observations, listing/citation observations, review
 * recording, audit runs, and issue lifecycle. `local_seo.measurements.
 * manage` for recording measurements/imports/audits (a narrower tier
 * than `local_seo.manage` — see permissions.ts); issue ACKNOWLEDGE/
 * RESOLVE/IGNORE/reopen reuse the same permission (day-to-day
 * operational triage, not structural engagement management). Mirrors
 * `seo-measurement-service.ts` exactly wherever the domain shape is the
 * same — a SEPARATE specialist domain, own tables, own event namespace.
 */

interface LocationContext {
  locationId: string;
  engagementId: string;
  customerServiceId: string;
  ownerUserId: string | null;
  companyName: string;
  locationDisplayName: string;
}

async function loadLocationContext(locationId: string, organizationId: string, tx: TransactionClient): Promise<LocationContext> {
  const location = await localSeoLocationRepository.findById(locationId, tx);
  if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
  const engagement = await localSeoEngagementRepository.findById(location.engagementId, tx);
  if (!engagement) throw new NotFoundError("Local SEO engagement");
  const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, ownerUserId: true } });
  const company = customerService ? await tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : null;
  return {
    locationId,
    engagementId: engagement.id,
    customerServiceId: engagement.customerServiceId,
    ownerUserId: customerService?.ownerUserId ?? null,
    companyName: company?.name ?? "Customer",
    locationDisplayName: location.businessName,
  };
}

async function notifyCriticalIssue(issue: LocalSeoIssue, ctx: LocationContext, organizationId: string): Promise<void> {
  if (issue.severity !== "CRITICAL" || issue.status !== "OPEN" || !ctx.ownerUserId) return;
  await events.emit("local_seo.critical_issue_detected", { issueId: issue.id, engagementId: ctx.engagementId, organizationId, ownerUserId: ctx.ownerUserId, locationDisplayName: ctx.locationDisplayName, issueTitle: issue.title, companyName: ctx.companyName });
}

// --- Local rank observations (manual) ---------------------------------------

const recordObservationSchema = z.object({
  keywordId: z.string().uuid(),
  observedAt: z.coerce.date(),
  rankStatus: z.enum(["RANKED", "NOT_FOUND", "BEYOND_TRACKED_RANGE", "SOURCE_ERROR"]),
  position: z.coerce.number().int().positive().max(2147483647).nullable().optional(),
  rankingProfileUrl: z.string().url().max(2048).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function recordLocalRankObservation(rawInput: unknown): Promise<LocalRankObservation> {
  const input = parseOrThrow(recordObservationSchema, rawInput);
  if (input.rankStatus === "RANKED" && !input.position) throw new ValidationError("position is required when rankStatus is RANKED.");
  if (input.rankStatus !== "RANKED" && input.position) throw new ValidationError("position must be omitted unless rankStatus is RANKED.");

  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");

  const observation = await withTenantContext(tenantScope, async (tx) => {
    const keyword = await localSeoKeywordRepository.findById(input.keywordId, tx);
    if (!keyword || keyword.organizationId !== organizationId) throw new NotFoundError("Local SEO keyword");
    const alreadyExists = await localRankObservationRepository.existsForKeywordAndDate(input.keywordId, input.observedAt, tx);
    if (alreadyExists) throw new ConflictError("An observation already exists for this keyword on this date.");

    return localRankObservationRepository.create(
      {
        id: generateId(),
        organizationId,
        keywordId: input.keywordId,
        observedAt: input.observedAt,
        source: "MANUAL",
        rankStatus: input.rankStatus,
        position: input.position ?? null,
        rankingProfileUrl: input.rankingProfileUrl ?? null,
        notes: input.notes ?? null,
        importBatchId: null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "localseo.rank_observation_recorded", organizationId, resourceType: "local_rank_observation", resourceId: observation.id, resourceName: `Observation ${observation.observedAt.toISOString().slice(0, 10)}`, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.rank_observation_recorded", error));
  return observation;
}

// --- Local rank observations (CSV import) -----------------------------------

const importSchema = z.object({
  locationId: z.string().uuid(),
  device: z.enum(["DESKTOP", "MOBILE"]),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  locale: z.string().min(2).max(35).nullable().optional(),
  searchLabel: z.string().trim().max(120).nullable().optional(),
  fileName: z.string().max(200).nullable().optional(),
  fileContent: z.string().min(1).max(2_000_000),
});

export interface ImportLocalRankObservationsResult {
  batchId: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  skippedReasons: { rowNumber: number; reason: string }[];
}

/**
 * Bulk-loads local rank observations for ALREADY-TRACKED keywords only —
 * never auto-creates a keyword, mirrors `importRankObservations()`'s own
 * exact "no fuzzy auto-mapping" discipline and its own found FK-ordering
 * fix (batch row created with provisional zero counts BEFORE the
 * observations that reference it, finalized after).
 */
export async function importLocalRankObservations(rawInput: unknown): Promise<ImportLocalRankObservationsResult> {
  const input = parseOrThrow(importSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const parsed = parseLocalRankObservationCsv(input.fileContent);
  if (parsed.totalDataRowCount > MAX_IMPORT_ROWS) throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);
  const rowCount = parsed.totalDataRowCount;

  const result = await withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");

    const skippedReasons: { rowNumber: number; reason: string }[] = parsed.rejected.map((r) => ({ rowNumber: r.rowNumber, reason: r.reason }));
    const toInsert: LocalRankObservationCreateInput[] = [];
    const seenInBatch = new Set<string>();
    const device: LocalSeoDevice = input.device;
    const country = input.country ?? null;
    const locale = input.locale ?? null;
    const searchLabel = input.searchLabel ?? null;

    // Same Build 30 Codex Performance Engineer finding P2 discipline —
    // prefetch every ACTIVE keyword for this location ONCE and match
    // rows in-memory, never one lookup per CSV row.
    const activeKeywords = await localSeoKeywordRepository.listActiveForLocation(input.locationId, tx);
    const keywordByDedupKey = new Map(
      activeKeywords.filter((k) => k.searchSurface === "LOCAL_PACK" && k.device === device && k.country === country && k.locale === locale && k.searchLabel === searchLabel).map((k) => [k.normalizedPhrase, k]),
    );

    for (const row of parsed.rows) {
      const normalizedPhrase = normalizeKeywordPhrase(row.phrase);
      const keyword = keywordByDedupKey.get(normalizedPhrase);
      if (!keyword) {
        skippedReasons.push({ rowNumber: row.rowNumber, reason: `No tracked keyword matches "${row.phrase}" for this location/device/search-point combination — add it first.` });
        continue;
      }
      const dedupKey = `${keyword.id}:${row.observedAt.toISOString()}`;
      if (seenInBatch.has(dedupKey)) {
        skippedReasons.push({ rowNumber: row.rowNumber, reason: "Duplicate keyword+date within this same file." });
        continue;
      }
      seenInBatch.add(dedupKey);
      toInsert.push({ id: generateId(), organizationId, keywordId: keyword.id, observedAt: row.observedAt, source: "IMPORT", rankStatus: row.rankStatus, position: row.position, rankingProfileUrl: row.rankingProfileUrl, notes: row.notes, importBatchId: null, createdByUserId: context.user!.id });
    }

    const batchId = generateId();
    const provisionalBatch = await localSeoImportBatchRepository.create({ id: batchId, organizationId, engagementId: location.engagementId, fileName: input.fileName ?? null, rowCount, importedCount: 0, skippedCount: 0, createdByUserId: context.user!.id }, tx);

    const insertedWithBatch = toInsert.map((row) => ({ ...row, importBatchId: batchId }));
    const importedCount = await localRankObservationRepository.createMany(insertedWithBatch, tx);
    const skippedCount = rowCount - importedCount;

    const batch = await localSeoImportBatchRepository.finalizeCounts(provisionalBatch.id, importedCount, skippedCount, tx);
    return { batch, importedCount, skippedCount, skippedReasons };
  });

  await audit
    .recordSuccess({
      action: "localseo.rank_observations_imported",
      organizationId,
      resourceType: "local_seo_import_batch",
      resourceId: result.batch.id,
      resourceName: input.fileName ?? "Local rank import",
      metadata: { rowCount, importedCount: result.importedCount, skippedCount: result.skippedCount },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record localseo.rank_observations_imported", error));

  return { batchId: result.batch.id, rowCount, importedCount: result.importedCount, skippedCount: result.skippedCount, skippedReasons: result.skippedReasons };
}

// --- Listings / citations -----------------------------------------------

const recordListingSchema = z.object({
  locationId: z.string().uuid(),
  sourceName: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().url().max(2048).refine(isHttpUrl, "sourceUrl must use http:// or https://").nullable().optional(),
  observedBusinessName: z.string().trim().max(200).nullable().optional(),
  observedAddressLine1: z.string().trim().max(200).nullable().optional(),
  observedCity: z.string().trim().max(120).nullable().optional(),
  observedPostalCode: z.string().trim().max(30).nullable().optional(),
  observedPhone: z.string().trim().max(40).nullable().optional(),
  observedWebsiteUrl: z.string().trim().url().max(2048).refine(isHttpUrl, "observedWebsiteUrl must use http:// or https://").nullable().optional(),
  observedAt: z.coerce.date(),
});

/**
 * Records (or re-records, in place) a location's listing on one external
 * directory/source. `observed*` fields preserve exactly what staff
 * entered — NAP consistency is computed LIVE at read time against the
 * parent location's own current fields (`src/lib/local-seo/nap.ts`),
 * never stored/denormalized here.
 */
export async function recordLocalListing(rawInput: unknown): Promise<LocalListing> {
  const input = parseOrThrow(recordListingSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");

  const listing = await withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");

    return localListingRepository.upsertObservation(
      generateId(),
      input.locationId,
      organizationId,
      input.sourceName,
      context.user!.id,
      {
        sourceUrl: input.sourceUrl ?? null,
        observedBusinessName: input.observedBusinessName ?? null,
        observedAddressLine1: input.observedAddressLine1 ?? null,
        observedCity: input.observedCity ?? null,
        observedPostalCode: input.observedPostalCode ?? null,
        observedPhone: input.observedPhone ?? null,
        observedWebsiteUrl: input.observedWebsiteUrl ?? null,
        observedAt: input.observedAt,
        source: "MANUAL",
        importBatchId: null,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "localseo.listing_recorded", organizationId, resourceType: "local_listing", resourceId: listing.id, resourceName: listing.sourceName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.listing_recorded", error));
  return listing;
}

const locationIdSchema = z.object({ locationId: z.string().uuid() });

export async function listLocalListings(rawInput: unknown): Promise<LocalListing[]> {
  const input = parseOrThrow(locationIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
    return localListingRepository.listForLocation(input.locationId, tx);
  });
}

// --- Reviews -----------------------------------------------------------

const recordReviewSchema = z.object({
  locationId: z.string().uuid(),
  externalReviewId: z.string().trim().max(200).nullable().optional(),
  rating: z.coerce.number().int().min(1).max(5),
  reviewedAt: z.coerce.date().nullable().optional(),
  reviewerDisplayName: z.string().trim().max(120).nullable().optional(),
  text: z.string().trim().max(4000).nullable().optional(),
});

/** A single review record — `reviewerDisplayName` is NEVER an Alpha OS `User` (plain text, no FK, minimal PII by design). */
export async function recordLocalReview(rawInput: unknown): Promise<LocalReview> {
  const input = parseOrThrow(recordReviewSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");

  const review = await withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
    if (input.externalReviewId) {
      const existing = await localReviewRepository.findByExternalId(input.locationId, input.externalReviewId, tx);
      if (existing) throw new ConflictError("A review with this external review ID has already been recorded for this location.");
    }
    return localReviewRepository.create(
      {
        id: generateId(),
        organizationId,
        locationId: input.locationId,
        externalReviewId: input.externalReviewId ?? null,
        rating: input.rating,
        reviewedAt: input.reviewedAt ?? null,
        reviewerDisplayName: input.reviewerDisplayName ?? null,
        text: input.text ?? null,
        source: "MANUAL",
        importBatchId: null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "localseo.review_recorded", organizationId, resourceType: "local_review", resourceId: review.id, resourceName: `Review (${review.rating}★)`, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.review_recorded", error));
  return review;
}

export async function listLocalReviews(rawInput: unknown) {
  const input = parseOrThrow(
    z.object({ locationId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }),
    rawInput,
  );
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
    return localReviewRepository.listForLocation(input.locationId, { page: input.page, limit: input.limit }, tx);
  });
}

async function loadReviewChecked(reviewId: string, organizationId: string, tx: TransactionClient): Promise<LocalReview> {
  const review = await localReviewRepository.findById(reviewId, tx);
  if (!review || review.organizationId !== organizationId) throw new NotFoundError("Local review");
  return review;
}

const draftReviewResponseSchema = z.object({ reviewId: z.string().uuid(), responseText: z.string().trim().min(1).max(2000) });

/** Records staff's own DRAFT response text — never publishes anything to Google (no provider API integration exists). */
export async function draftLocalReviewResponse(rawInput: unknown): Promise<LocalReview> {
  const input = parseOrThrow(draftReviewResponseSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const review = await withTenantContext(tenantScope, async (tx) => {
    await loadReviewChecked(input.reviewId, organizationId, tx);
    return localReviewRepository.recordResponse(input.reviewId, { responseStatus: "DRAFTED", responseText: input.responseText, respondedAt: null, respondedByUserId: null }, tx);
  });
  await audit
    .recordSuccess({ action: "localseo.review_response_recorded", organizationId, resourceType: "local_review", resourceId: review.id, resourceName: "Draft response", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.review_response_recorded", error));
  return review;
}

const confirmReviewResponseSchema = z.object({ reviewId: z.string().uuid(), responseText: z.string().trim().min(1).max(2000).nullable().optional() });

/**
 * Records that staff CONFIRM a response actually happened externally —
 * this never calls Google or publishes anything itself (no provider API
 * integration exists — see docs/architecture/gbp-local-seo.md "Provider
 * boundary"). `respondedAt` is always "now" (the moment staff confirm
 * it, not a backdated/customer-supplied value).
 */
export async function confirmLocalReviewResponse(rawInput: unknown): Promise<LocalReview> {
  const input = parseOrThrow(confirmReviewResponseSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const review = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadReviewChecked(input.reviewId, organizationId, tx);
    const responseText = input.responseText ?? existing.responseText;
    if (!responseText) throw new ValidationError("A response cannot be confirmed without response text.");
    return localReviewRepository.recordResponse(input.reviewId, { responseStatus: "RESPONDED", responseText, respondedAt: new Date(), respondedByUserId: context.user!.id }, tx);
  });
  await audit
    .recordSuccess({ action: "localseo.review_response_recorded", organizationId, resourceType: "local_review", resourceId: review.id, resourceName: "Confirmed response", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.review_response_recorded", error));
  return review;
}

// --- Audits + issues ----------------------------------------------

const auditIssueInputSchema = z.object({
  issueType: z.enum(["NAP_INCONSISTENCY", "MISSING_LISTING", "PROFILE_INCOMPLETE", "UNVERIFIED_PROFILE", "REVIEW_RESPONSE_BACKLOG", "OTHER"]),
  severity: z.enum(["CRITICAL", "WARNING", "INFO"]),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).nullable().optional(),
});

const recordAuditRunSchema = z.object({
  locationId: z.string().uuid(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  issues: z.array(auditIssueInputSchema).max(100).default([]),
});

export interface RecordLocalSeoAuditRunResult {
  auditRun: LocalSeoAuditRun;
  createdIssueCount: number;
  reconfirmedIssueCount: number;
  reopenedIssueCount: number;
}

/**
 * Records a Local SEO audit event (MANUAL only — no crawler exists),
 * plus every issue staff observed during it. Dedup key is
 * (locationId, issueType) — Local SEO issues are location-scoped, no
 * pageUrl-equivalent dimension. Mirrors `recordSeoAuditRun()`'s own
 * create/reconfirm/reopen discipline exactly.
 */
export async function recordLocalSeoAuditRun(rawInput: unknown): Promise<RecordLocalSeoAuditRunResult> {
  const input = parseOrThrow(recordAuditRunSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");

  const { auditRun, createdIssueCount, reconfirmedIssueCount, reopenedIssueCount, newlyOpenCriticalIssues, locationContext } = await withTenantContext(tenantScope, async (tx) => {
    const locationContext = await loadLocationContext(input.locationId, organizationId, tx);
    const startedAt = input.startedAt;
    const completedAt = input.completedAt ?? startedAt;

    const auditRun = await localSeoAuditRunRepository.create({ id: generateId(), organizationId, locationId: input.locationId, source: "MANUAL", status: "COMPLETED", startedAt, completedAt, summary: input.summary ?? null, createdByUserId: context.user!.id }, tx);

    let createdIssueCount = 0;
    let reconfirmedIssueCount = 0;
    let reopenedIssueCount = 0;
    const newlyOpenCriticalIssues: LocalSeoIssue[] = [];

    const existingIssues = input.issues.length > 0 ? await tx.localSeoIssue.findMany({ where: { locationId: input.locationId, issueType: { in: input.issues.map((i) => i.issueType) } } }) : [];
    const existingByDedupKey = new Map(existingIssues.map((i) => [i.issueType, i]));

    for (const issueInput of input.issues) {
      const existing = existingByDedupKey.get(issueInput.issueType) ?? null;
      if (!existing) {
        const created = await localSeoIssueRepository.create(
          {
            id: generateId(),
            organizationId,
            locationId: input.locationId,
            issueType: issueInput.issueType,
            severity: issueInput.severity,
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
        const reopened = await localSeoIssueRepository.reopen(existing.id, completedAt, auditRun.id, tx);
        if (reopened) {
          reopenedIssueCount++;
          if (reopened.severity === "CRITICAL") newlyOpenCriticalIssues.push(reopened);
        }
      } else {
        await localSeoIssueRepository.reconfirm(existing.id, completedAt, auditRun.id, tx);
        reconfirmedIssueCount++;
      }
    }

    return { auditRun, createdIssueCount, reconfirmedIssueCount, reopenedIssueCount, newlyOpenCriticalIssues, locationContext };
  });

  await audit
    .recordSuccess({
      action: "localseo.audit_run_recorded",
      organizationId,
      resourceType: "local_seo_audit_run",
      resourceId: auditRun.id,
      resourceName: locationContext.locationDisplayName,
      metadata: { createdIssueCount, reconfirmedIssueCount, reopenedIssueCount },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record localseo.audit_run_recorded", error));

  for (const issue of newlyOpenCriticalIssues) await notifyCriticalIssue(issue, locationContext, organizationId);

  return { auditRun, createdIssueCount, reconfirmedIssueCount, reopenedIssueCount };
}

// --- Manual issue entry (no audit run) --------------------------------------

const createIssueManuallySchema = z.object({ locationId: z.string().uuid(), ...auditIssueInputSchema.shape });

export async function createLocalSeoIssueManually(rawInput: unknown): Promise<LocalSeoIssue> {
  const input = parseOrThrow(createIssueManuallySchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");

  const { issue, locationContext, wasReopened } = await withTenantContext(tenantScope, async (tx) => {
    const locationContext = await loadLocationContext(input.locationId, organizationId, tx);
    const now = new Date();
    const existing = await localSeoIssueRepository.findByDedupKey(input.locationId, input.issueType, tx);
    if (existing && (existing.status === "OPEN" || existing.status === "ACKNOWLEDGED")) {
      throw new ConflictError("This issue is already open for this location.");
    }
    if (existing) {
      const reopened = await localSeoIssueRepository.reopen(existing.id, now, null, tx);
      if (!reopened) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
      return { issue: reopened, locationContext, wasReopened: true };
    }
    const created = await localSeoIssueRepository.create(
      { id: generateId(), organizationId, locationId: input.locationId, issueType: input.issueType, severity: input.severity, title: input.title, description: input.description ?? null, detectedByAuditRunId: null, firstDetectedAt: now, lastDetectedAt: now, createdByUserId: context.user!.id },
      tx,
    );
    return { issue: created, locationContext, wasReopened: false };
  });

  await audit
    .recordSuccess({ action: "localseo.issue_created", organizationId, resourceType: "local_seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.issue_created", error));
  if (wasReopened) {
    await audit
      .recordSuccess({ action: "localseo.issue_reopened", organizationId, resourceType: "local_seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record localseo.issue_reopened", error));
  }
  await notifyCriticalIssue(issue, locationContext, organizationId);
  return issue;
}

// --- Issue lifecycle ----------------------------------------------------

const issueIdSchema = z.object({ issueId: z.string().uuid() });

async function loadIssueLocked(issueId: string, organizationId: string, tx: TransactionClient): Promise<LocalSeoIssue> {
  const issue = await localSeoIssueRepository.findByIdLocked(issueId, tx);
  if (!issue || issue.organizationId !== organizationId) throw new NotFoundError("Local SEO issue");
  return issue;
}

export async function acknowledgeLocalSeoIssue(rawInput: unknown): Promise<LocalSeoIssue> {
  const input = parseOrThrow(issueIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const issue = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionLocalSeoIssue(existing.status, "ACKNOWLEDGED")) throw new ValidationError(`Cannot acknowledge a ${existing.status} issue.`);
    const updated = await localSeoIssueRepository.acknowledge(input.issueId, context.user!.id, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.issue_acknowledged", organizationId, resourceType: "local_seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.issue_acknowledged", error));
  return issue;
}

const resolveIssueSchema = z.object({ issueId: z.string().uuid(), resolutionNotes: z.string().trim().max(1000).nullable().optional() });

export async function resolveLocalSeoIssue(rawInput: unknown): Promise<LocalSeoIssue> {
  const input = parseOrThrow(resolveIssueSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const issue = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionLocalSeoIssue(existing.status, "RESOLVED")) throw new ValidationError(`Cannot resolve a ${existing.status} issue.`);
    const updated = await localSeoIssueRepository.resolve(input.issueId, context.user!.id, input.resolutionNotes ?? null, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.issue_resolved", organizationId, resourceType: "local_seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.issue_resolved", error));
  return issue;
}

const ignoreIssueSchema = z.object({ issueId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function ignoreLocalSeoIssue(rawInput: unknown): Promise<LocalSeoIssue> {
  const input = parseOrThrow(ignoreIssueSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const issue = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionLocalSeoIssue(existing.status, "IGNORED")) throw new ValidationError(`Cannot ignore a ${existing.status} issue.`);
    const updated = await localSeoIssueRepository.ignore(input.issueId, context.user!.id, input.reason, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.issue_ignored", organizationId, resourceType: "local_seo_issue", resourceId: issue.id, resourceName: issue.title, metadata: { reason: input.reason }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.issue_ignored", error));
  return issue;
}

export async function reopenLocalSeoIssue(rawInput: unknown): Promise<LocalSeoIssue> {
  const input = parseOrThrow(issueIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");
  const { issue, locationContext } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await loadIssueLocked(input.issueId, organizationId, tx);
    if (!canTransitionLocalSeoIssue(existing.status, "OPEN")) throw new ValidationError(`Cannot reopen a ${existing.status} issue.`);
    const updated = await localSeoIssueRepository.reopen(input.issueId, new Date(), null, tx);
    if (!updated) throw new ConflictError("This issue was just changed by someone else. Reload and try again.");
    const locationContext = await loadLocationContext(updated.locationId, organizationId, tx);
    return { issue: updated, locationContext };
  });
  await audit
    .recordSuccess({ action: "localseo.issue_reopened", organizationId, resourceType: "local_seo_issue", resourceId: issue.id, resourceName: issue.title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.issue_reopened", error));
  await notifyCriticalIssue(issue, locationContext, organizationId);
  return issue;
}

/**
 * Converts an issue into a real, trackable `InternalTask` via Task
 * Management's own creation API — never inserts a task row directly,
 * never a duplicate task system (no `LocalSeoTask`). Same Build 30
 * Codex Security Engineer finding SEO-SEC-05 CAS-guarded-link +
 * compensate-on-lost-race discipline `linkSeoIssueToTask()` established.
 */
export async function linkLocalSeoIssueToTask(rawInput: unknown): Promise<LocalSeoIssue> {
  const input = parseOrThrow(issueIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.measurements.manage");

  const issue = await withTenantContext(tenantScope, (tx) => loadIssueLocked(input.issueId, organizationId, tx));
  if (issue.linkedTaskId) throw new ValidationError("This issue is already linked to a task.");

  const task = await createInternalTask({ title: `Local SEO issue: ${issue.title}`, description: issue.description ?? undefined, priority: issue.severity === "CRITICAL" ? "HIGH" : "MEDIUM" });

  const linked = await withTenantContext(tenantScope, (tx) => localSeoIssueRepository.linkTask(input.issueId, task.id, tx));
  if (!linked) {
    await cancelInternalTask({ taskId: task.id, reason: "Superseded by a concurrent link to the same Local SEO issue." }).catch((error) => console.error("[local-seo] failed to cancel orphaned task after a lost linkLocalSeoIssueToTask race", error));
    throw new ConflictError("This issue was just linked to a task by someone else. Reload and try again.");
  }

  await audit
    .recordSuccess({ action: "localseo.issue_linked_to_task", organizationId, resourceType: "local_seo_issue", resourceId: linked.id, resourceName: linked.title, metadata: { taskId: task.id }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.issue_linked_to_task", error));
  return linked;
}

const listIssuesSchema = z.object({
  locationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"]).optional(),
  severity: z.enum(["CRITICAL", "WARNING", "INFO"]).optional(),
});

export async function listLocalSeoIssues(rawInput: unknown) {
  const input = parseOrThrow(listIssuesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
    return localSeoIssueRepository.listForLocation(input.locationId, { page: input.page, limit: input.limit }, { status: input.status, severity: input.severity }, tx);
  });
}

const listAuditRunsSchema = z.object({ locationId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export async function listLocalSeoAuditRuns(rawInput: unknown): Promise<LocalSeoAuditRun[]> {
  const input = parseOrThrow(listAuditRunsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const location = await localSeoLocationRepository.findById(input.locationId, tx);
    if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
    return localSeoAuditRunRepository.listForLocation(input.locationId, input.limit, tx);
  });
}
