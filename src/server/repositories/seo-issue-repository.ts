import "server-only";
import type { SeoIssue, SeoIssueType, SeoIssueSeverity, SeoIssueStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";

export interface SeoIssueListFilters {
  status?: SeoIssueStatus;
  severity?: SeoIssueSeverity;
}

/**
 * Data access for `SeoIssue` (Build 30 — Roadmap Module 24) — the
 * persistent CONDITION. No DELETE grant. `findByDedupKey()` mirrors
 * `seoKeywordRepository.findByDedupKey()`'s own reasoning: an exact-
 * match `findFirst` (including `pageUrl: null`) agrees with the DB's
 * own two partial unique indexes without needing to replicate their
 * WHERE clauses in application code.
 */
export const seoIssueRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      propertyId: string;
      issueType: SeoIssueType;
      severity: SeoIssueSeverity;
      pageUrl: string | null;
      title: string;
      description: string | null;
      detectedByAuditRunId: string | null;
      firstDetectedAt: Date;
      lastDetectedAt: Date;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<SeoIssue> {
    return withDbErrorTranslation(() => tx.seoIssue.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id } }));
  },

  async findByDedupKey(propertyId: string, issueType: SeoIssueType, pageUrl: string | null, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    return withDbErrorTranslation(() => tx.seoIssue.findFirst({ where: { propertyId, issueType, pageUrl } }));
  },

  async listForProperty(propertyId: string, params: OffsetPaginationParams, filters: SeoIssueListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<SeoIssue>> {
    const where = { propertyId, ...(filters.status ? { status: filters.status } : {}), ...(filters.severity ? { severity: filters.severity } : {}) };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.seoIssue.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.seoIssue.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Every OPEN/ACKNOWLEDGED issue across a set of properties, batched — the source for both the KPI severity counts and the Client Success performance projection. Bounded to 500 (a realistic ceiling — an engagement with more than 500 simultaneously-open issues has bigger problems than pagination). */
  async listOpenForProperties(propertyIds: string[], tx: TransactionClient | typeof db = db): Promise<SeoIssue[]> {
    if (propertyIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.seoIssue.findMany({ where: { propertyId: { in: propertyIds }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, take: 500 }));
  },

  /** Row-locked read — serializes concurrent lifecycle transitions on the same issue, same reasoning `customerServiceRepository.findByIdLocked()` establishes. */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<SeoIssue | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM seo_issues WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id: locked[0]!.id } }));
  },

  async acknowledge(id: string, acknowledgedByUserId: string, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    const result = await withDbErrorTranslation(() => tx.seoIssue.updateMany({ where: { id, status: { in: ["OPEN"] } }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedByUserId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id } }));
  },

  async resolve(id: string, resolvedByUserId: string, resolutionNotes: string | null, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    const result = await withDbErrorTranslation(() =>
      tx.seoIssue.updateMany({ where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId, resolutionNotes } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id } }));
  },

  async ignore(id: string, ignoredByUserId: string, ignoredReason: string, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    const result = await withDbErrorTranslation(() =>
      tx.seoIssue.updateMany({ where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "IGNORED", ignoredAt: new Date(), ignoredByUserId, ignoredReason } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id } }));
  },

  /** Reopen — from RESOLVED/IGNORED back to OPEN (either an explicit staff action, or a recurrence detected during a later audit run). Clears the resolved/ignored fields (never leaves stale "resolvedAt" on a now-OPEN issue) but never touches `firstDetectedAt`. Always bumps `lastDetectedAt`. */
  async reopen(id: string, lastDetectedAt: Date, detectedByAuditRunId: string | null, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    const result = await withDbErrorTranslation(() =>
      tx.seoIssue.updateMany({
        where: { id, status: { in: ["RESOLVED", "IGNORED"] } },
        data: {
          status: "OPEN",
          lastDetectedAt,
          ...(detectedByAuditRunId ? { detectedByAuditRunId } : {}),
          resolvedAt: null,
          resolvedByUserId: null,
          resolutionNotes: null,
          ignoredAt: null,
          ignoredByUserId: null,
          ignoredReason: null,
        },
      }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id } }));
  },

  /** A later audit run reconfirms an already-OPEN/ACKNOWLEDGED issue is still present — just bumps `lastDetectedAt`, no status change. */
  async reconfirm(id: string, lastDetectedAt: Date, detectedByAuditRunId: string | null, tx: TransactionClient | typeof db = db): Promise<SeoIssue> {
    return withDbErrorTranslation(() => tx.seoIssue.update({ where: { id }, data: { lastDetectedAt, ...(detectedByAuditRunId ? { detectedByAuditRunId } : {}) } }));
  },

  /**
   * CAS-guarded on `linkedTaskId IS NULL` — Build 30 Codex Security
   * Engineer finding SEO-SEC-05: the issue's own row lock
   * (`findByIdLocked()`) is released before `createInternalTask()` runs
   * (a real cross-service call, not something that can happen inside
   * the SAME transaction), so two concurrent `linkSeoIssueToTask()`
   * calls could both pass an initial "not yet linked" check and each
   * create a real task, with the second write silently overwriting the
   * first's `linkedTaskId`. A lost race now returns `null` instead of
   * silently overwriting — the caller compensates by cancelling its own
   * just-created, now-orphaned task.
   */
  async linkTask(id: string, linkedTaskId: string, tx: TransactionClient | typeof db = db): Promise<SeoIssue | null> {
    const result = await withDbErrorTranslation(() => tx.seoIssue.updateMany({ where: { id, linkedTaskId: null }, data: { linkedTaskId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.seoIssue.findUnique({ where: { id } }));
  },
};
