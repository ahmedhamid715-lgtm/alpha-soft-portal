import "server-only";
import type { GhlWorkspace, GhlWorkspaceStatus, GhlHandoffStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface GhlWorkspaceCreateInput {
  id: string;
  organizationId: string;
  engagementId: string;
  name: string;
  externalLocationId: string | null;
  locationUrl: string | null;
  createdByUserId: string;
}

export type GhlWorkspaceUpdateInput = Partial<Pick<GhlWorkspaceCreateInput, "name" | "externalLocationId" | "locationUrl"> & { goLiveTargetDate: Date | null; handoffStatus: GhlHandoffStatus }>;

/** Data access for `GhlWorkspace` (Build 34 — Roadmap Module 28). No DELETE grant — retired via `status = ARCHIVED`. Bounded to 100 per engagement (a realistic ceiling — most engagements deliver a single workspace). Mirrors `ecommerceStoreRepository` exactly. */
export const ghlWorkspaceRepository = {
  async create(input: GhlWorkspaceCreateInput, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace> {
    return withDbErrorTranslation(() => tx.ghlWorkspace.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace | null> {
    return withDbErrorTranslation(() => tx.ghlWorkspace.findUnique({ where: { id } }));
  },

  async findByExternalLocationId(engagementId: string, externalLocationId: string, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace | null> {
    return withDbErrorTranslation(() => tx.ghlWorkspace.findFirst({ where: { engagementId, externalLocationId } }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace[]> {
    return withDbErrorTranslation(() => tx.ghlWorkspace.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" }, take: 100 }));
  },

  /** Batched across several engagements at once — never one query per engagement. */
  async listForEngagements(engagementIds: string[], tx: TransactionClient | typeof db = db): Promise<GhlWorkspace[]> {
    if (engagementIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.ghlWorkspace.findMany({ where: { engagementId: { in: engagementIds } }, orderBy: { createdAt: "asc" } }));
  },

  async update(id: string, data: GhlWorkspaceUpdateInput, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace> {
    return withDbErrorTranslation(() => tx.ghlWorkspace.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status` currently NOT `ARCHIVED` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace | null> {
    const result = await withDbErrorTranslation(() => tx.ghlWorkspace.updateMany({ where: { id, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ghlWorkspace.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — restores to `IN_DEVELOPMENT` (never silently back to `LIVE`, which must be re-earned via a real go-live record). */
  async reactivate(id: string, restoreStatus: GhlWorkspaceStatus, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace | null> {
    const result = await withDbErrorTranslation(() => tx.ghlWorkspace.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: restoreStatus } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ghlWorkspace.findUnique({ where: { id } }));
  },

  /** The go-live operation itself — CAS-guarded on `status` currently NOT `LIVE` AND NOT `ARCHIVED` (mirrors E-Commerce's own launch CAS: an archived workspace must go through `reactivate()` first, never go live directly). */
  async recordGoLive(id: string, goLiveRecordedAt: Date, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace | null> {
    const result = await withDbErrorTranslation(() => tx.ghlWorkspace.updateMany({ where: { id, status: { notIn: ["LIVE", "ARCHIVED"] } }, data: { status: "LIVE", goLiveRecordedAt } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ghlWorkspace.findUnique({ where: { id } }));
  },

  /** The handoff-completion operation itself — CAS-guarded on `handoffStatus` currently NOT `COMPLETED` (a distinct dimension from `status`, independently guarded against double-submit/replay). */
  async recordHandoff(id: string, handoffRecordedAt: Date, handoffNotes: string | null, tx: TransactionClient | typeof db = db): Promise<GhlWorkspace | null> {
    const result = await withDbErrorTranslation(() => tx.ghlWorkspace.updateMany({ where: { id, handoffStatus: { not: "COMPLETED" } }, data: { handoffStatus: "COMPLETED", handoffRecordedAt, handoffNotes } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ghlWorkspace.findUnique({ where: { id } }));
  },
};
