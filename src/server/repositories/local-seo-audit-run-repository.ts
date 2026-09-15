import "server-only";
import type { LocalSeoAuditRun, LocalSeoDataSource, LocalSeoAuditRunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `LocalSeoAuditRun` (Build 31 — Roadmap Module 25) — the observation EVENT, separate from `LocalSeoIssue` (the persistent condition). MANUAL only (no crawler exists). No DELETE grant. Mirrors `seoAuditRunRepository` exactly. */
export const localSeoAuditRunRepository = {
  async create(
    input: { id: string; organizationId: string; locationId: string; source: LocalSeoDataSource; status: LocalSeoAuditRunStatus; startedAt: Date; completedAt: Date | null; summary: string | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<LocalSeoAuditRun> {
    return withDbErrorTranslation(() => tx.localSeoAuditRun.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoAuditRun | null> {
    return withDbErrorTranslation(() => tx.localSeoAuditRun.findUnique({ where: { id } }));
  },

  async listForLocation(locationId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<LocalSeoAuditRun[]> {
    return withDbErrorTranslation(() => tx.localSeoAuditRun.findMany({ where: { locationId }, orderBy: { startedAt: "desc" }, take: Math.min(limit, 100) }));
  },

  async findLatestForLocation(locationId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoAuditRun | null> {
    return withDbErrorTranslation(() => tx.localSeoAuditRun.findFirst({ where: { locationId }, orderBy: { startedAt: "desc" } }));
  },
};
