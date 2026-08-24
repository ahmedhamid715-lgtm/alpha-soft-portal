import "server-only";
import type { KnowledgeDocument, KnowledgeDocumentVersion, KnowledgeIngestionStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

/** Data access for `KnowledgeDocument`/`KnowledgeDocumentVersion` — RLS-protected; every real call runs inside `withTenantContext()`. */
export const knowledgeDocumentRepository = {
  async create(
    input: { id: string; sourceId: string; organizationId: string | null; title: string; canonicalId: string | null; contentType: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<KnowledgeDocument> {
    return withDbErrorTranslation(() =>
      tx.knowledgeDocument.create({
        data: { id: input.id, sourceId: input.sourceId, organizationId: input.organizationId, title: input.title, canonicalId: input.canonicalId, contentType: input.contentType },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocument | null> {
    return withDbErrorTranslation(() => tx.knowledgeDocument.findFirst({ where: { id, deletedAt: null } }));
  },

  /** Includes soft-deleted rows — the one lookup that deliberately does NOT filter `deletedAt`, used only by the deletion-security test proving the row still physically exists after a "delete" (see knowledge-security.md "Deletion — soft, but genuinely unreachable"). Never call this from ordinary application code paths. */
  async findByIdIncludingDeleted(id: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocument | null> {
    return withDbErrorTranslation(() => tx.knowledgeDocument.findUnique({ where: { id } }));
  },

  /** The idempotency lookup `ingestText()` uses — matches the partial unique index (`knowledge_documents_source_canonical_key`) exactly: non-null canonicalId, not soft-deleted. */
  async findBySourceAndCanonicalId(sourceId: string, canonicalId: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocument | null> {
    return withDbErrorTranslation(() => tx.knowledgeDocument.findFirst({ where: { sourceId, canonicalId, deletedAt: null } }));
  },

  async listForSource(sourceId: string, params: OffsetPaginationParams, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<KnowledgeDocument>> {
    const where = { sourceId, deletedAt: null };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([
        tx.knowledgeDocument.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }),
        tx.knowledgeDocument.count({ where }),
      ]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  async setCurrentVersion(documentId: string, versionId: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocument> {
    return withDbErrorTranslation(() => tx.knowledgeDocument.update({ where: { id: documentId }, data: { currentVersionId: versionId } }));
  },

  async softDelete(id: string, deletedBy: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocument> {
    return withDbErrorTranslation(() => tx.knowledgeDocument.update({ where: { id }, data: { deletedAt: new Date(), deletedBy, currentVersionId: null } }));
  },

  // --- Versions ---------------------------------------------------------

  async createVersion(
    input: { id: string; documentId: string; versionNumber: number; content: string; contentChecksum: string; sourceMetadata: object | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<KnowledgeDocumentVersion> {
    return withDbErrorTranslation(() =>
      tx.knowledgeDocumentVersion.create({
        data: { id: input.id, documentId: input.documentId, versionNumber: input.versionNumber, content: input.content, contentChecksum: input.contentChecksum, sourceMetadata: input.sourceMetadata ?? undefined },
      }),
    );
  },

  async findLatestVersion(documentId: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocumentVersion | null> {
    return withDbErrorTranslation(() => tx.knowledgeDocumentVersion.findFirst({ where: { documentId }, orderBy: { versionNumber: "desc" } }));
  },

  async findVersionById(id: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocumentVersion | null> {
    return withDbErrorTranslation(() => tx.knowledgeDocumentVersion.findUnique({ where: { id } }));
  },

  async listVersionsForDocument(documentId: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocumentVersion[]> {
    return withDbErrorTranslation(() => tx.knowledgeDocumentVersion.findMany({ where: { documentId }, orderBy: { versionNumber: "desc" } }));
  },

  async updateVersionStatus(
    id: string,
    status: KnowledgeIngestionStatus,
    extra: { failureReason?: string | null; chunkCount?: number; readyAt?: Date } = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<KnowledgeDocumentVersion> {
    return withDbErrorTranslation(() =>
      tx.knowledgeDocumentVersion.update({
        where: { id },
        data: { status, failureReason: extra.failureReason, chunkCount: extra.chunkCount, readyAt: extra.readyAt },
      }),
    );
  },

  async markSuperseded(id: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeDocumentVersion> {
    return withDbErrorTranslation(() => tx.knowledgeDocumentVersion.update({ where: { id }, data: { status: "SUPERSEDED" } }));
  },
};
