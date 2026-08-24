import "server-only";
import type { KnowledgeChunk, KnowledgeEmbedding } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface ChunkSearchRow {
  chunkId: string;
  documentVersionId: string;
  documentId: string;
  sourceId: string;
  sequence: number;
  content: string;
  /** Method-specific: `ts_rank` for keyword search (higher = better), cosine distance for vector search (LOWER = better) — never compared directly against each other; `ranking.ts`'s RRF combines by RANK POSITION, not this raw value. */
  score: number;
}

/**
 * Data access for `KnowledgeChunk` — RLS-protected; every real call
 * runs inside `withTenantContext()`. The two search methods are the
 * ONLY place in this module's repository layer that hand-write raw SQL
 * beyond a simple `$queryRaw` cast — required because Prisma's query
 * builder has no full-text-search operator, and because
 * `knowledge-embedding-repository.ts` owns the vector-distance join
 * this file's own `vectorSearch` delegates to for symmetry (both
 * search methods live here so `knowledge-retrieval-service.ts` has one
 * consistent import for "the two retrieval strategies").
 *
 * **Authorization participates in the query itself** (spec §8) —
 * `includeElevatedClassifications` is a caller-DECIDED boolean (the
 * service layer resolves it from `requirePermission()`, never from
 * client input), baked into the `WHERE` clause; never "search
 * everything, then filter out what they can't see."
 */
export const knowledgeChunkRepository = {
  async createMany(
    chunks: { id: string; documentVersionId: string; organizationId: string | null; sequence: number; content: string; charCount: number; tokenCount: number; checksum: string; chunkingStrategy: string; structuralMetadata?: object | null }[],
    tx: TransactionClient | typeof db = db,
  ): Promise<void> {
    if (chunks.length === 0) return;
    await withDbErrorTranslation(() =>
      tx.knowledgeChunk.createMany({
        data: chunks.map((c) => ({
          id: c.id,
          documentVersionId: c.documentVersionId,
          organizationId: c.organizationId,
          sequence: c.sequence,
          content: c.content,
          charCount: c.charCount,
          tokenCount: c.tokenCount,
          checksum: c.checksum,
          chunkingStrategy: c.chunkingStrategy,
          structuralMetadata: c.structuralMetadata ?? undefined,
        })),
      }),
    );
  },

  async listForVersion(documentVersionId: string, chunkingStrategy: string, tx: TransactionClient | typeof db = db): Promise<KnowledgeChunk[]> {
    return withDbErrorTranslation(() => tx.knowledgeChunk.findMany({ where: { documentVersionId, chunkingStrategy }, orderBy: { sequence: "asc" } }));
  },

  async findByIds(ids: string[], tx: TransactionClient | typeof db = db): Promise<KnowledgeChunk[]> {
    if (ids.length === 0) return [];
    return withDbErrorTranslation(() => tx.knowledgeChunk.findMany({ where: { id: { in: ids } } }));
  },

  /** Same as `findByIds`, plus each chunk's own embeddings — used only by the ingestion service's own idempotency check ("does this chunk already have an embedding for the CURRENT provider/model") to avoid a wasted `.embed()` call on re-processing. */
  async findByIdsWithEmbeddings(ids: string[], tx: TransactionClient | typeof db = db): Promise<(KnowledgeChunk & { embeddings: KnowledgeEmbedding[] })[]> {
    if (ids.length === 0) return [];
    return withDbErrorTranslation(() => tx.knowledgeChunk.findMany({ where: { id: { in: ids } }, include: { embeddings: true } }));
  },

  /**
   * Keyword search — real Postgres full-text search
   * (`plainto_tsquery`/`to_tsvector`, the same `'english'` config the
   * migration's own GIN index uses). Scoped to the CURRENT ready
   * version of each document only (`d.current_version_id = v.id`) —
   * a stale/superseded version's chunks are never retrievable, even
   * though the rows still exist (spec §18's own "stale document
   * version retrieval" adversarial case).
   */
  async keywordSearch(
    params: { organizationId: string; chunkingStrategy: string; query: string; includeElevatedClassifications: boolean; limit: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<ChunkSearchRow[]> {
    // `knowledge_sources` is ALWAYS joined (never only in the
    // classification-gated branch below) — a DISABLED/ARCHIVED source's
    // documents must never be retrievable regardless of classification,
    // the exact behavior this module's own knowledge UI promises
    // ("Archive this source — its documents stop being retrievable").
    const rows = params.includeElevatedClassifications
      ? await withDbErrorTranslation(() =>
          tx.$queryRaw<ChunkSearchRow[]>`
            SELECT c.id AS "chunkId", c.document_version_id AS "documentVersionId", d.id AS "documentId", d.source_id AS "sourceId",
                   c.sequence, c.content,
                   ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', ${params.query})) AS score
            FROM knowledge_chunks c
            JOIN knowledge_document_versions v ON v.id = c.document_version_id
            JOIN knowledge_documents d ON d.id = v.document_id AND d.current_version_id = v.id AND d.deleted_at IS NULL
            JOIN knowledge_sources s ON s.id = d.source_id AND s.status = 'ACTIVE'
            WHERE (c.organization_id = ${params.organizationId}::uuid OR c.organization_id IS NULL)
              AND c.chunking_strategy = ${params.chunkingStrategy}
              AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${params.query})
            ORDER BY score DESC
            LIMIT ${params.limit}
          `,
        )
      : await withDbErrorTranslation(() =>
          tx.$queryRaw<ChunkSearchRow[]>`
            SELECT c.id AS "chunkId", c.document_version_id AS "documentVersionId", d.id AS "documentId", d.source_id AS "sourceId",
                   c.sequence, c.content,
                   ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', ${params.query})) AS score
            FROM knowledge_chunks c
            JOIN knowledge_document_versions v ON v.id = c.document_version_id
            JOIN knowledge_documents d ON d.id = v.document_id AND d.current_version_id = v.id AND d.deleted_at IS NULL
            JOIN knowledge_sources s ON s.id = d.source_id AND s.status = 'ACTIVE' AND s.classification NOT IN ('CONFIDENTIAL', 'RESTRICTED')
            WHERE (c.organization_id = ${params.organizationId}::uuid OR c.organization_id IS NULL)
              AND c.chunking_strategy = ${params.chunkingStrategy}
              AND to_tsvector('english', c.content) @@ plainto_tsquery('english', ${params.query})
            ORDER BY score DESC
            LIMIT ${params.limit}
          `,
        );
    return rows;
  },
};
