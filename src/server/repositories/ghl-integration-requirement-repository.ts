import "server-only";
import type { GhlIntegrationRequirement, GhlIntegrationRequirementStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface GhlIntegrationRequirementCounts {
  requiredCount: number;
  confirmedRequiredCount: number;
}

function emptyCounts(): GhlIntegrationRequirementCounts {
  return { requiredCount: 0, confirmedRequiredCount: 0 };
}

/** Data access for `GhlIntegrationRequirement` (Build 34 — Roadmap Module 28). No DELETE grant. A small typed table, genuinely separate shape from `GhlAsset` (required-boolean + NOT_CONFIGURED/CONFIGURED/CONFIRMED vocabulary, not implementation-lifecycle states). */
export const ghlIntegrationRequirementRepository = {
  async create(
    input: { id: string; organizationId: string; workspaceId: string; name: string; required: boolean; externalSystemLabel: string | null; customerVisible: boolean; notes: string | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<GhlIntegrationRequirement> {
    return withDbErrorTranslation(() => tx.ghlIntegrationRequirement.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<GhlIntegrationRequirement | null> {
    return withDbErrorTranslation(() => tx.ghlIntegrationRequirement.findUnique({ where: { id } }));
  },

  async listForWorkspace(workspaceId: string, tx: TransactionClient | typeof db = db): Promise<GhlIntegrationRequirement[]> {
    return withDbErrorTranslation(() => tx.ghlIntegrationRequirement.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, take: 200 }));
  },

  /** Batched across several workspaces at once — never one query per workspace. Codex Performance Engineer finding PERF-GHL-02 — bounded to 2000 (a generous realistic ceiling for a batch read, matching `ecommerceVariantRepository.listForProducts()`'s own precedent) rather than left fully unbounded. */
  async listForWorkspaces(workspaceIds: string[], tx: TransactionClient | typeof db = db): Promise<GhlIntegrationRequirement[]> {
    if (workspaceIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.ghlIntegrationRequirement.findMany({ where: { workspaceId: { in: workspaceIds } }, orderBy: { createdAt: "asc" }, take: 2000 }));
  },

  /** Exact required/confirmed-required counts for one workspace — used by every readiness/go-live-gate path, never by materializing requirement rows. */
  async countsForWorkspace(workspaceId: string, tx: TransactionClient | typeof db = db): Promise<GhlIntegrationRequirementCounts> {
    const map = await this.countsForWorkspaces([workspaceId], tx);
    return map.get(workspaceId) ?? emptyCounts();
  },

  /** Batched across several workspaces at once. */
  async countsForWorkspaces(workspaceIds: string[], tx: TransactionClient | typeof db = db): Promise<Map<string, GhlIntegrationRequirementCounts>> {
    const result = new Map<string, GhlIntegrationRequirementCounts>();
    for (const workspaceId of workspaceIds) result.set(workspaceId, emptyCounts());
    if (workspaceIds.length === 0) return result;

    const rows = await withDbErrorTranslation(() => tx.ghlIntegrationRequirement.groupBy({ by: ["workspaceId", "required", "status"], where: { workspaceId: { in: workspaceIds } }, _count: { _all: true } }));
    for (const row of rows) {
      const counts = result.get(row.workspaceId);
      if (!counts) continue;
      const n = row._count._all;
      if (row.required) {
        counts.requiredCount += n;
        if (row.status === "CONFIRMED") counts.confirmedRequiredCount += n;
      }
    }
    return result;
  },

  async update(id: string, data: Partial<{ name: string; required: boolean; externalSystemLabel: string | null; customerVisible: boolean; notes: string | null }>, tx: TransactionClient | typeof db = db): Promise<GhlIntegrationRequirement> {
    return withDbErrorTranslation(() => tx.ghlIntegrationRequirement.update({ where: { id }, data }));
  },

  async updateStatus(id: string, status: GhlIntegrationRequirementStatus, tx: TransactionClient | typeof db = db): Promise<GhlIntegrationRequirement> {
    return withDbErrorTranslation(() => tx.ghlIntegrationRequirement.update({ where: { id }, data: { status } }));
  },
};
