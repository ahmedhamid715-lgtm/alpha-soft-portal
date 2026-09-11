import "server-only";
import type { SeoAuditRun, SeoDataSource, SeoAuditRunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `SeoAuditRun` (Build 30 — Roadmap Module 24) — the observation EVENT, separate from `SeoIssue` (the persistent condition). No DELETE grant. */
export const seoAuditRunRepository = {
  async create(
    input: { id: string; organizationId: string; propertyId: string; source: SeoDataSource; status: SeoAuditRunStatus; startedAt: Date; completedAt: Date | null; summary: string | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<SeoAuditRun> {
    return withDbErrorTranslation(() => tx.seoAuditRun.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<SeoAuditRun | null> {
    return withDbErrorTranslation(() => tx.seoAuditRun.findUnique({ where: { id } }));
  },

  async listForProperty(propertyId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<SeoAuditRun[]> {
    return withDbErrorTranslation(() => tx.seoAuditRun.findMany({ where: { propertyId }, orderBy: { startedAt: "desc" }, take: Math.min(limit, 100) }));
  },

  async findLatestForProperty(propertyId: string, tx: TransactionClient | typeof db = db): Promise<SeoAuditRun | null> {
    return withDbErrorTranslation(() => tx.seoAuditRun.findFirst({ where: { propertyId }, orderBy: { startedAt: "desc" } }));
  },
};
