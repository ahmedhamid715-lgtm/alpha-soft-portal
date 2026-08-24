import "server-only";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import type { ChunkSearchRow } from "./knowledge-chunk-repository";

/**
 * Data access for `KnowledgeEmbedding` — RLS-protected (transitively,
 * via `chunk_id` -> `knowledge_chunks.organization_id`); every real
 * call runs inside `withTenantContext()`.
 *
 * `vector` is a Prisma `Unsupported("vector(1536)")` column — every
 * read/write here is raw, PARAMETERIZED SQL. The vector value is
 * always passed as a plain bound string parameter (`[0.1,0.2,...]`,
 * pgvector's own documented external text format) built from an array
 * of NUMBERS this module generated itself via a real embedding call —
 * never from unsanitized external text — then cast with `::vector` at
 * the SQL level. No string concatenation of untrusted input anywhere
 * in this file.
 */
export const knowledgeEmbeddingRepository = {
  async createMany(
    embeddings: { id: string; chunkId: string; provider: string; model: string; dimension: number; vector: number[] }[],
    tx: TransactionClient | typeof db = db,
  ): Promise<void> {
    for (const e of embeddings) {
      const vectorLiteral = `[${e.vector.join(",")}]`;
      await withDbErrorTranslation(() =>
        tx.$executeRaw`
          INSERT INTO knowledge_embeddings (id, chunk_id, provider, model, dimension, vector, created_at)
          VALUES (${e.id}::uuid, ${e.chunkId}::uuid, ${e.provider}, ${e.model}, ${e.dimension}, ${vectorLiteral}::vector, now())
        `,
      );
    }
  },

  /**
   * Vector similarity search — cosine distance (`<=>`, matching the
   * migration's own `vector_cosine_ops` HNSW index) ascending (LOWER
   * distance = more similar). Same scoping/gating shape as
   * `knowledgeChunkRepository.keywordSearch()` — see that method's own
   * doc comment for the "current version only, deleted excluded,
   * classification gated in the query itself" reasoning, identical
   * here.
   */
  async vectorSearch(
    params: { organizationId: string; provider: string; model: string; queryVector: number[]; includeElevatedClassifications: boolean; limit: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<ChunkSearchRow[]> {
    const vectorLiteral = `[${params.queryVector.join(",")}]`;
    // `knowledge_sources` is ALWAYS joined — see
    // `knowledgeChunkRepository.keywordSearch()`'s own identical
    // comment for why a DISABLED/ARCHIVED source's chunks must never be
    // retrievable regardless of classification.
    const rows = params.includeElevatedClassifications
      ? await withDbErrorTranslation(() =>
          tx.$queryRaw<ChunkSearchRow[]>`
            SELECT c.id AS "chunkId", c.document_version_id AS "documentVersionId", d.id AS "documentId", d.source_id AS "sourceId",
                   c.sequence, c.content,
                   (e.vector <=> ${vectorLiteral}::vector) AS score
            FROM knowledge_embeddings e
            JOIN knowledge_chunks c ON c.id = e.chunk_id
            JOIN knowledge_document_versions v ON v.id = c.document_version_id
            JOIN knowledge_documents d ON d.id = v.document_id AND d.current_version_id = v.id AND d.deleted_at IS NULL
            JOIN knowledge_sources s ON s.id = d.source_id AND s.status = 'ACTIVE'
            WHERE (c.organization_id = ${params.organizationId}::uuid OR c.organization_id IS NULL)
              AND e.provider = ${params.provider}
              AND e.model = ${params.model}
            ORDER BY score ASC
            LIMIT ${params.limit}
          `,
        )
      : await withDbErrorTranslation(() =>
          tx.$queryRaw<ChunkSearchRow[]>`
            SELECT c.id AS "chunkId", c.document_version_id AS "documentVersionId", d.id AS "documentId", d.source_id AS "sourceId",
                   c.sequence, c.content,
                   (e.vector <=> ${vectorLiteral}::vector) AS score
            FROM knowledge_embeddings e
            JOIN knowledge_chunks c ON c.id = e.chunk_id
            JOIN knowledge_document_versions v ON v.id = c.document_version_id
            JOIN knowledge_documents d ON d.id = v.document_id AND d.current_version_id = v.id AND d.deleted_at IS NULL
            JOIN knowledge_sources s ON s.id = d.source_id AND s.status = 'ACTIVE' AND s.classification NOT IN ('CONFIDENTIAL', 'RESTRICTED')
            WHERE (c.organization_id = ${params.organizationId}::uuid OR c.organization_id IS NULL)
              AND e.provider = ${params.provider}
              AND e.model = ${params.model}
            ORDER BY score ASC
            LIMIT ${params.limit}
          `,
        );
    return rows;
  },
};
