-- Build 29 (Service Management) — Codex Performance Engineer review
-- follow-up. Hand-written (not `prisma migrate dev`'s auto-diff), same
-- discipline every migration in this codebase follows since Build 28's
-- own finding: `migrate dev`'s schema-diff engine flags unrelated
-- pre-existing drift (the `crm_companies` unique constraint and the
-- `knowledge_embeddings` pgvector HNSW index don't round-trip through
-- Prisma's own DDL generation) that must NOT be touched by this change.

-- CreateIndex
CREATE INDEX "customer_services_organization_id_created_at_id_idx" ON "customer_services"("organization_id", "created_at" DESC, "id");
