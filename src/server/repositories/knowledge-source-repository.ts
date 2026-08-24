import "server-only";
import type { KnowledgeSource, KnowledgeSourceStatus, KnowledgeSourceType, DataClassification } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

/** Data access for `KnowledgeSource` — RLS-protected; every real call runs inside `withTenantContext()`. */
export const knowledgeSourceRepository = {
  async create(
    input: { id: string; organizationId: string | null; type: KnowledgeSourceType; name: string; description: string | null; classification: DataClassification },
    tx: TransactionClient | typeof db = db,
  ): Promise<KnowledgeSource> {
    return withDbErrorTranslation(() =>
      tx.knowledgeSource.create({
        data: { id: input.id, organizationId: input.organizationId, type: input.type, name: input.name, description: input.description, classification: input.classification },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeSource | null> {
    return withDbErrorTranslation(() => tx.knowledgeSource.findUnique({ where: { id } }));
  },

  /** This organization's own sources PLUS platform-level sources (`organizationId IS NULL`) — RLS already enforces this same visibility rule at the database level; this WHERE clause matches it explicitly rather than relying solely on RLS, so the query's own intent is legible without reading the migration. */
  async listForOrganization(organizationId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<KnowledgeSource>> {
    const where = { OR: [{ organizationId }, { organizationId: null }] };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.knowledgeSource.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.knowledgeSource.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  /** Platform-only sources (`organizationId IS NULL`) — the platform knowledge management surface, never mixed with any customer organization's own sources. */
  async listPlatform(params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<KnowledgeSource>> {
    const where = { organizationId: null };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.knowledgeSource.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.knowledgeSource.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async updateStatus(id: string, status: KnowledgeSourceStatus, tx: TransactionClient | typeof db = db): Promise<KnowledgeSource> {
    return withDbErrorTranslation(() =>
      tx.knowledgeSource.update({ where: { id }, data: { status, archivedAt: status === "ARCHIVED" ? new Date() : undefined } }),
    );
  },
};
