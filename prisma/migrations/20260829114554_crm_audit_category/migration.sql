-- AlterEnum
ALTER TYPE "audit_category" ADD VALUE 'CRM';

-- NOTE: Prisma's shadow-database diff proposes `DROP INDEX
-- "knowledge_embeddings_vector_hnsw_idx"` here on every migration that
-- touches anything in this schema. This is a recurring false positive:
-- the HNSW vector index was hand-written in migration
-- 20260824141711_ai_knowledge_retrieval_infrastructure (no `@@index`
-- equivalent exists for pgvector HNSW opclasses), so Prisma's shadow
-- diff doesn't recognize it and proposes dropping what it can't model.
-- Deliberately stripped here, as in every prior migration that hit
-- this. Do not apply that DROP INDEX statement.
