-- CreateEnum
CREATE TYPE "knowledge_source_type" AS ENUM ('MANUAL');

-- CreateEnum
CREATE TYPE "knowledge_source_status" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "data_classification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "knowledge_ingestion_status" AS ENUM ('QUEUED', 'PROCESSING', 'CHUNKING', 'EMBEDDING', 'READY', 'FAILED', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "audit_category" ADD VALUE 'KNOWLEDGE';

-- pgvector (Module 18) — verified genuinely available and working
-- (installed via `brew install pgvector`, confirmed against the
-- restricted `alpha_os_app` role too, not just the migration
-- superuser) before this migration was written; not assumed. See
-- docs/architecture/retrieval.md "pgvector availability" for the exact
-- verification steps to repeat in any other environment (including
-- Supabase, which bundles pgvector natively — Database -> Extensions
-- -> vector, or `create extension vector;` from the SQL editor).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "type" "knowledge_source_type" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "knowledge_source_status" NOT NULL DEFAULT 'ACTIVE',
    "classification" "data_classification" NOT NULL DEFAULT 'INTERNAL',
    "metadata" JSONB,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "organization_id" UUID,
    "title" TEXT NOT NULL,
    "canonical_id" TEXT,
    "content_type" TEXT NOT NULL DEFAULT 'text/plain',
    "current_version_id" UUID,
    "metadata" JSONB,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_checksum" TEXT NOT NULL,
    "status" "knowledge_ingestion_status" NOT NULL DEFAULT 'QUEUED',
    "failure_reason" TEXT,
    "chunk_count" INTEGER,
    "source_metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "organization_id" UUID,
    "sequence" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "token_count" INTEGER,
    "checksum" TEXT NOT NULL,
    "chunking_strategy" TEXT NOT NULL,
    "structural_metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "vector" vector(1536) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_status_idx" ON "knowledge_sources"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_current_version_id_key" ON "knowledge_documents"("current_version_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_source_id_deleted_at_idx" ON "knowledge_documents"("source_id", "deleted_at");

-- CreateIndex
CREATE INDEX "knowledge_documents_organization_id_deleted_at_idx" ON "knowledge_documents"("organization_id", "deleted_at");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_document_id_created_at_idx" ON "knowledge_document_versions"("document_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_versions_document_id_version_number_key" ON "knowledge_document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "knowledge_chunks_organization_id_idx" ON "knowledge_chunks"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_version_id_chunking_strategy_sequ_key" ON "knowledge_chunks"("document_version_id", "chunking_strategy", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_embeddings_chunk_id_provider_model_key" ON "knowledge_embeddings"("chunk_id", "provider", "model");

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index (Module 18) — `canonicalId` uniqueness is
-- per-source, only among non-null values, and only among NOT-deleted
-- documents (the same "roles_system_key_key" partial-index technique
-- rbac.md already established for a NULL-aware uniqueness rule Prisma's
-- schema syntax can't express directly). Excluding soft-deleted rows
-- deliberately: re-ingesting the same canonicalId after its document
-- was deleted creates a fresh document rather than colliding with the
-- deleted one — the more predictable product behavior (see
-- knowledge-ingestion.md "Idempotency and canonicalId").
CREATE UNIQUE INDEX "knowledge_documents_source_canonical_key"
  ON "knowledge_documents" ("source_id", "canonical_id")
  WHERE "canonical_id" IS NOT NULL AND "deleted_at" IS NULL;

-- Vector similarity index (Module 18) — HNSW, cosine distance
-- (`vector_cosine_ops`), matching OpenAI's own recommendation for
-- normalized embeddings and this module's own `<=>` operator usage in
-- `knowledge-retrieval-service.ts`. At this dev environment's real row
-- count (a handful of fixture chunks), the query planner will
-- correctly prefer a sequential scan over this index — the exact same
-- "small table, seqscan is genuinely correct, not an RLS/index
-- problem" honesty `rls.md`'s own Performance section already
-- documents for `organization_memberships`. Created now for real
-- production-scale readiness, not because it measurably helps today.
CREATE INDEX "knowledge_embeddings_vector_hnsw_idx"
  ON "knowledge_embeddings" USING hnsw ("vector" vector_cosine_ops);

-- Full-text search index (Module 18) — the keyword side of hybrid
-- retrieval (`knowledge-retrieval-service.ts`'s `keywordSearch()`). A
-- functional GIN index on `to_tsvector('english', content)` rather than
-- a generated `tsvector` column: this module has no requirement for a
-- non-English corpus or per-row language selection yet, and a
-- functional index avoids an extra denormalized column for a value
-- trivially re-derivable from `content` itself.
CREATE INDEX "knowledge_chunks_content_fts_idx"
  ON "knowledge_chunks" USING gin (to_tsvector('english', "content"));

-- Row-Level Security (Module 18) — see schema.prisma's own file-level
-- comment above the KnowledgeSource model for the full ownership
-- reasoning. Two ownership shapes:
--   - knowledge_sources / knowledge_documents / knowledge_chunks: a
--     DIRECT, nullable organization_id. SELECT allows organization_id
--     IS NULL (platform-level knowledge, visible to every organization
--     — the exact "roles" table precedent, rls.md "Protected tables")
--     in addition to the caller's own organization and platform staff;
--     INSERT/UPDATE are narrower (never organization_id IS NULL for a
--     non-platform caller — the same "roles" table split).
--   - knowledge_document_versions / knowledge_embeddings: TRANSITIVELY
--     owned via a one-hop EXISTS through their direct parent — the same
--     pattern ai_messages/invoice_line_items already use.
-- FORCE ROW LEVEL SECURITY throughout.
--
-- knowledge_document_versions is PROCESSING-STATE MUTABLE, not fully
-- immutable — a genuine correction from this migration's own first
-- draft, caught by this module's own integration tests (not by
-- inspection): `status`/`failureReason`/`chunkCount`/`readyAt`
-- legitimately change as a version moves QUEUED -> ... -> READY/FAILED
-- (`knowledge-ingestion-service.ts`'s own `processDocumentVersion()`),
-- the same "mutable status field, otherwise stable" shape
-- `AiConversation.status` already has — NOT the fully-immutable
-- `AiMessage`/`audit_events` shape this migration originally (wrongly)
-- copied. `content`/`contentChecksum`/`versionNumber` remain
-- effectively immutable in practice (no UPDATE call site ever touches
-- them — see the repository's own `updateVersionStatus()`, the only
-- UPDATE this table receives), enforced by convention/code review, not
-- by a column-level grant Postgres can express independently of a
-- table-level UPDATE privilege.
--
-- knowledge_chunks/knowledge_embeddings ARE fully immutable/append-only
-- — no UPDATE/DELETE policy, no UPDATE/DELETE grant (below). No DELETE
-- policy at all on knowledge_sources (Archivable), knowledge_documents
-- (Softdeletable), or knowledge_document_versions (superseded, never
-- deleted) — app code never hard-deletes any of the three, so any
-- future attempt is blocked at the database level too, the same
-- belt-and-suspenders discipline audit_events already established.

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON knowledge_sources
  FOR SELECT
  USING (organization_id IS NULL OR organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON knowledge_sources
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON knowledge_sources
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON knowledge_documents
  FOR SELECT
  USING (organization_id IS NULL OR organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON knowledge_documents
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON knowledge_documents
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

ALTER TABLE knowledge_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON knowledge_document_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM knowledge_documents d
      WHERE d.id = knowledge_document_versions.document_id
        AND (d.organization_id IS NULL OR d.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON knowledge_document_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM knowledge_documents d
      WHERE d.id = knowledge_document_versions.document_id
        AND (d.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- UPDATE is real and necessary here — see this file's own top comment
-- ("PROCESSING-STATE MUTABLE, not fully immutable"). Same shape as
-- INSERT: never allows retargeting a row across the organization
-- boundary via UPDATE.
CREATE POLICY tenant_isolation_update ON knowledge_document_versions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM knowledge_documents d
      WHERE d.id = knowledge_document_versions.document_id
        AND (d.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM knowledge_documents d
      WHERE d.id = knowledge_document_versions.document_id
        AND (d.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- No DELETE policy — a version is superseded, never deleted.

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON knowledge_chunks
  FOR SELECT
  USING (organization_id IS NULL OR organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON knowledge_chunks
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- No UPDATE/DELETE policy — immutable, append-only.

ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embeddings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON knowledge_embeddings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM knowledge_chunks c
      WHERE c.id = knowledge_embeddings.chunk_id
        AND (c.organization_id IS NULL OR c.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON knowledge_embeddings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM knowledge_chunks c
      WHERE c.id = knowledge_embeddings.chunk_id
        AND (c.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- No UPDATE/DELETE policy — immutable, append-only.

-- Grant-layer defense-in-depth (Module 18) — the same "two independent
-- layers, neither a substitute for the other" discipline
-- `audit_events` already established (audit-security.md): RLS having
-- no UPDATE/DELETE policy already blocks these at the row level, but
-- REVOKEing the privilege outright means even a future bug that
-- somehow bypassed RLS (or a raw query run with FORCE RLS
-- misconfigured) would still be refused at the grant layer. Sources/
-- documents/versions all keep UPDATE (versions need it for real
-- processing-state transitions — see this file's own top comment) but
-- never DELETE (no app code path hard-deletes any of the three).
-- Chunks/embeddings never need UPDATE either — genuinely immutable.
REVOKE DELETE ON knowledge_sources FROM alpha_os_app;
REVOKE DELETE ON knowledge_documents FROM alpha_os_app;
REVOKE DELETE ON knowledge_document_versions FROM alpha_os_app;
REVOKE UPDATE, DELETE ON knowledge_chunks FROM alpha_os_app;
REVOKE UPDATE, DELETE ON knowledge_embeddings FROM alpha_os_app;
