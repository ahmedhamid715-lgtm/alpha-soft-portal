-- NOTE: Prisma's shadow-database diff also proposes
-- `DROP INDEX "knowledge_embeddings_vector_hnsw_idx"` here, the same
-- recurring false positive documented in every prior build's own
-- migration (the shadow db can't represent this hand-written HNSW index
-- the same way the real migration created it). Deliberately stripped —
-- see 20260830113550_sales_pipeline_foundation's own comment for the
-- original explanation.

-- DropIndex
DROP INDEX "crm_contracts_organization_id_deal_id_idx";

-- DropIndex
DROP INDEX "crm_proposals_assigned_to_user_id_status_idx";

-- DropIndex
DROP INDEX "crm_proposals_organization_id_deal_id_idx";

-- CreateIndex
CREATE INDEX "crm_contracts_organization_id_deal_id_created_at_idx" ON "crm_contracts"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_contracts_organization_id_created_at_idx" ON "crm_contracts"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_proposals_organization_id_deal_id_created_at_idx" ON "crm_proposals"("organization_id", "deal_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_proposals_organization_id_created_at_idx" ON "crm_proposals"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_proposals_organization_id_assigned_to_user_id_created_a_idx" ON "crm_proposals"("organization_id", "assigned_to_user_id", "created_at");

-- NOTE: Prisma's shadow-database diff also proposes the same stale
-- `ALTER INDEX "crm_custom_field_definitions_organization_id_entity_type_label_"`
-- rename documented by Build 21 and re-encountered in this same Build 22's
-- own 20260831085940_proposals_contracts migration (see that file's own
-- comment). The source index was already renamed to its final name by
-- 20260830161000_crm_query_indexes; this statement would target an index
-- that no longer exists. Deliberately stripped.
