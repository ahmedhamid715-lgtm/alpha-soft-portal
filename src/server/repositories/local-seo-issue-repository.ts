import "server-only";
import type { LocalSeoIssue, LocalSeoIssueType, LocalSeoIssueSeverity, LocalSeoIssueStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";

export interface LocalSeoIssueListFilters {
  status?: LocalSeoIssueStatus;
  severity?: LocalSeoIssueSeverity;
}

/**
 * Data access for `LocalSeoIssue` (Build 31 — Roadmap Module 25) — the
 * persistent CONDITION. No DELETE grant. Dedup key is (locationId,
 * issueType) — Local SEO issues are location-scoped, not per-page (no
 * `pageUrl`-equivalent dimension, unlike `SeoIssue`). Mirrors
 * `seoIssueRepository` exactly otherwise, including its own explicit
 * app-layer dedup discipline (no DB-level unique constraint here either
 * — same precedent `SeoIssue` itself already establishes; see that
 * model's own repository comment).
 */
export const localSeoIssueRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      locationId: string;
      issueType: LocalSeoIssueType;
      severity: LocalSeoIssueSeverity;
      title: string;
      description: string | null;
      detectedByAuditRunId: string | null;
      firstDetectedAt: Date;
      lastDetectedAt: Date;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<LocalSeoIssue> {
    return withDbErrorTranslation(() => tx.localSeoIssue.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id } }));
  },

  async findByDedupKey(locationId: string, issueType: LocalSeoIssueType, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    return withDbErrorTranslation(() => tx.localSeoIssue.findFirst({ where: { locationId, issueType } }));
  },

  async listForLocation(locationId: string, params: OffsetPaginationParams, filters: LocalSeoIssueListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<LocalSeoIssue>> {
    const where = { locationId, ...(filters.status ? { status: filters.status } : {}), ...(filters.severity ? { severity: filters.severity } : {}) };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.localSeoIssue.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.localSeoIssue.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Every OPEN/ACKNOWLEDGED issue across a set of locations, batched — the source for both the KPI severity counts and the Client Success performance projection. Bounded to 500. */
  async listOpenForLocations(locationIds: string[], tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue[]> {
    if (locationIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.localSeoIssue.findMany({ where: { locationId: { in: locationIds }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, take: 500 }));
  },

  /** Row-locked read — serializes concurrent lifecycle transitions on the same issue, same reasoning `seoIssueRepository.findByIdLocked()` establishes. */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<LocalSeoIssue | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM local_seo_issues WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id: locked[0]!.id } }));
  },

  async acknowledge(id: string, acknowledgedByUserId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    const result = await withDbErrorTranslation(() => tx.localSeoIssue.updateMany({ where: { id, status: { in: ["OPEN"] } }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedByUserId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id } }));
  },

  async resolve(id: string, resolvedByUserId: string, resolutionNotes: string | null, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    const result = await withDbErrorTranslation(() =>
      tx.localSeoIssue.updateMany({ where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId, resolutionNotes } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id } }));
  },

  async ignore(id: string, ignoredByUserId: string, ignoredReason: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    const result = await withDbErrorTranslation(() =>
      tx.localSeoIssue.updateMany({ where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: "IGNORED", ignoredAt: new Date(), ignoredByUserId, ignoredReason } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id } }));
  },

  /** Reopen — from RESOLVED/IGNORED back to OPEN. Clears the resolved/ignored fields, never touches `firstDetectedAt`. Always bumps `lastDetectedAt`. */
  async reopen(id: string, lastDetectedAt: Date, detectedByAuditRunId: string | null, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    const result = await withDbErrorTranslation(() =>
      tx.localSeoIssue.updateMany({
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
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id } }));
  },

  /** A later audit run reconfirms an already-OPEN/ACKNOWLEDGED issue is still present — just bumps `lastDetectedAt`, no status change. */
  async reconfirm(id: string, lastDetectedAt: Date, detectedByAuditRunId: string | null, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue> {
    return withDbErrorTranslation(() => tx.localSeoIssue.update({ where: { id }, data: { lastDetectedAt, ...(detectedByAuditRunId ? { detectedByAuditRunId } : {}) } }));
  },

  /** CAS-guarded on `linkedTaskId IS NULL` — same Build 30 Codex Security Engineer finding SEO-SEC-05 reasoning `seoIssueRepository.linkTask()` documents: the row lock is released before `createInternalTask()` runs, so a lost race here returns `null` instead of silently overwriting. */
  async linkTask(id: string, linkedTaskId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoIssue | null> {
    const result = await withDbErrorTranslation(() => tx.localSeoIssue.updateMany({ where: { id, linkedTaskId: null }, data: { linkedTaskId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.localSeoIssue.findUnique({ where: { id } }));
  },
};
