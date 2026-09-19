import "server-only";
import type { GhlAsset, GhlAssetImplementationStatus, GhlAssetType, GhlAssetSource } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toOffsetPaginatedResult, type OffsetPaginatedResult, type OffsetPaginationParams } from "@/lib/platform/pagination";
import { GHL_ASSET_READY_STATUSES } from "@/lib/ghl/asset-lifecycle";

export interface GhlAssetListFilters {
  assetType?: GhlAssetType;
  implementationStatus?: GhlAssetImplementationStatus;
  search?: string;
}

export interface GhlAssetCounts {
  assetCount: number;
  requiredAssetCount: number;
  completedRequiredAssetCount: number;
  qaFailedRequiredAssetCount: number;
}

function emptyCounts(): GhlAssetCounts {
  return { assetCount: 0, requiredAssetCount: 0, completedRequiredAssetCount: 0, qaFailedRequiredAssetCount: 0 };
}

/**
 * Data access for `GhlAsset` (Build 34 — Roadmap Module 28). No DELETE
 * grant — retired via `implementationStatus = ARCHIVED`. Asset lists
 * may be large (a complex GHL account may have hundreds of workflows/
 * funnels/forms) — `countsForWorkspace()`/`countsForWorkspaces()` apply
 * E-Commerce's own Build 33 "exact SQL `groupBy` aggregate, never a
 * capped-row-fetch treated as an exact count" discipline FROM THE START
 * (never as a follow-up fix, the way Website Dev's own Build 32 had to
 * discover it mid-build).
 */
export const ghlAssetRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      workspaceId: string;
      assetType: GhlAssetType;
      name: string;
      externalAssetId: string | null;
      source: GhlAssetSource;
      requiredForLaunch: boolean;
      customerVisible: boolean;
      sortOrder: number;
      notes: string | null;
      importBatchId: string | null;
      createdByUserId: string;
      implementationStatus?: GhlAssetImplementationStatus;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<GhlAsset> {
    return withDbErrorTranslation(() => tx.ghlAsset.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<GhlAsset | null> {
    return withDbErrorTranslation(() => tx.ghlAsset.findUnique({ where: { id } }));
  },

  async findByExternalAssetId(workspaceId: string, externalAssetId: string, tx: TransactionClient | typeof db = db): Promise<GhlAsset | null> {
    return withDbErrorTranslation(() => tx.ghlAsset.findFirst({ where: { workspaceId, externalAssetId } }));
  },

  async listForWorkspace(workspaceId: string, params: OffsetPaginationParams, filters: GhlAssetListFilters, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<GhlAsset>> {
    const where = {
      workspaceId,
      ...(filters.assetType ? { assetType: filters.assetType } : {}),
      ...(filters.implementationStatus ? { implementationStatus: filters.implementationStatus } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await withDbErrorTranslation(() =>
      Promise.all([tx.ghlAsset.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], skip: (params.page - 1) * params.limit, take: params.limit }), tx.ghlAsset.count({ where })]),
    );
    return toOffsetPaginatedResult(items, params, total);
  },

  /** Exact asset/required-asset/completed-required-asset/QA-failed-required-asset counts for one workspace — used by every KPI/readiness/go-live-gate path, never by materializing asset rows. */
  async countsForWorkspace(workspaceId: string, tx: TransactionClient | typeof db = db): Promise<GhlAssetCounts> {
    const map = await this.countsForWorkspaces([workspaceId], tx);
    return map.get(workspaceId) ?? emptyCounts();
  },

  /** Batched across several workspaces at once — never one query per workspace, and never one global row cap shared across all workspaces. */
  async countsForWorkspaces(workspaceIds: string[], tx: TransactionClient | typeof db = db): Promise<Map<string, GhlAssetCounts>> {
    const result = new Map<string, GhlAssetCounts>();
    for (const workspaceId of workspaceIds) result.set(workspaceId, emptyCounts());
    if (workspaceIds.length === 0) return result;

    const rows = await withDbErrorTranslation(() => tx.ghlAsset.groupBy({ by: ["workspaceId", "requiredForLaunch", "implementationStatus"], where: { workspaceId: { in: workspaceIds } }, _count: { _all: true } }));
    for (const row of rows) {
      const counts = result.get(row.workspaceId);
      if (!counts) continue;
      const n = row._count._all;
      counts.assetCount += n;
      if (row.requiredForLaunch) {
        counts.requiredAssetCount += n;
        if (GHL_ASSET_READY_STATUSES.includes(row.implementationStatus)) counts.completedRequiredAssetCount += n;
        if (row.implementationStatus === "QA_FAILED") counts.qaFailedRequiredAssetCount += n;
      }
    }
    return result;
  },

  async update(id: string, data: Partial<{ name: string; externalAssetId: string | null; requiredForLaunch: boolean; customerVisible: boolean; sortOrder: number; notes: string | null }>, tx: TransactionClient | typeof db = db): Promise<GhlAsset> {
    return withDbErrorTranslation(() => tx.ghlAsset.update({ where: { id }, data }));
  },

  /** CAS-guarded on the exact `from` status — closes a lost-update race between two concurrent lifecycle transitions on the same asset. */
  async transition(id: string, from: GhlAssetImplementationStatus, to: GhlAssetImplementationStatus, tx: TransactionClient | typeof db = db): Promise<GhlAsset | null> {
    const result = await withDbErrorTranslation(() => tx.ghlAsset.updateMany({ where: { id, implementationStatus: from }, data: { implementationStatus: to } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.ghlAsset.findUnique({ where: { id } }));
  },
};
