-- CreateEnum
CREATE TYPE "crm_pipeline_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "crm_pipeline_stage_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "crm_deal_status" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "crm_deal_history_type" AS ENUM ('CREATED', 'STAGE_CHANGED', 'VALUE_CHANGED', 'PROBABILITY_CHANGED', 'EXPECTED_CLOSE_DATE_CHANGED', 'OWNER_CHANGED', 'WON', 'LOST', 'REOPENED', 'NOTE');

-- Known Prisma shadow-diff false positive stripped: preserve the hand-written knowledge_embeddings_vector_hnsw_idx HNSW index.

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "crm_pipeline_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "crm_pipeline_stage_status" NOT NULL DEFAULT 'ACTIVE',
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "default_probability" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "primary_contact_id" UUID,
    "source_lead_id" UUID,
    "title" TEXT NOT NULL,
    "value_minor_units" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "probability" INTEGER,
    "expected_close_date" TIMESTAMPTZ(3),
    "status" "crm_deal_status" NOT NULL DEFAULT 'OPEN',
    "assigned_to_user_id" UUID,
    "loss_reason" TEXT,
    "won_at" TIMESTAMPTZ(3),
    "lost_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_history" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "type" "crm_deal_history_type" NOT NULL,
    "metadata" JSONB,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_pipelines_organization_id_status_idx" ON "crm_pipelines"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_organization_id_name_key" ON "crm_pipelines"("organization_id", "name");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_organization_id_pipeline_id_sort_order_idx" ON "crm_pipeline_stages"("organization_id", "pipeline_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipeline_stages_pipeline_id_name_key" ON "crm_pipeline_stages"("pipeline_id", "name");

-- CreateIndex
CREATE INDEX "crm_deals_organization_id_status_created_at_idx" ON "crm_deals"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "crm_deals_organization_id_pipeline_id_stage_id_idx" ON "crm_deals"("organization_id", "pipeline_id", "stage_id");

-- CreateIndex
CREATE INDEX "crm_deals_organization_id_expected_close_date_idx" ON "crm_deals"("organization_id", "expected_close_date");

-- CreateIndex
CREATE INDEX "crm_deals_company_id_created_at_idx" ON "crm_deals"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_deals_assigned_to_user_id_status_idx" ON "crm_deals"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "crm_deals_source_lead_id_idx" ON "crm_deals"("source_lead_id");

-- CreateIndex
CREATE INDEX "crm_deal_history_organization_id_deal_id_occurred_at_idx" ON "crm_deal_history"("organization_id", "deal_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_source_lead_id_fkey" FOREIGN KEY ("source_lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_history" ADD CONSTRAINT "crm_deal_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_history" ADD CONSTRAINT "crm_deal_history_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_history" ADD CONSTRAINT "crm_deal_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unrelated generated index-rename drift stripped: the source index is created by the later 20260830161000_crm_query_indexes migration.

-- Sales-pipeline financial-domain constraints (Build 20).
ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_value_minor_units_nonnegative_check
  CHECK (value_minor_units >= 0);

ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_probability_range_check
  CHECK (probability IS NULL OR probability BETWEEN 0 AND 100);

-- Prisma cannot express a filtered/partial unique index. Enforce at most
-- one default sales pipeline per organization at the database boundary.
CREATE UNIQUE INDEX crm_pipelines_one_default_per_org
  ON crm_pipelines (organization_id)
  WHERE is_default = true;

-- Build 20 / sales-pipeline relationship integrity.
--
-- RLS validates each directly-owned row's own organization_id, but a plain
-- single-column foreign key does not prove that the referenced CRM parent is
-- owned by that same organization. These BEFORE triggers close that nested
-- cross-tenant association gap for every sales-pipeline relationship. The
-- function is deliberately SECURITY INVOKER: parent lookups remain subject to
-- the same restricted-role RLS context as the write itself, so an invisible
-- parent is rejected exactly like a parent from the wrong organization.

CREATE FUNCTION crm_pipeline_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  parent_organization_id UUID;
  parent_pipeline_id UUID;
  parent_company_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'crm_pipeline_stages' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_pipelines
     WHERE id = NEW.pipeline_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM pipeline stage pipeline must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_deals' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_pipelines
     WHERE id = NEW.pipeline_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM deal pipeline must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    SELECT organization_id, pipeline_id
      INTO parent_organization_id, parent_pipeline_id
      FROM crm_pipeline_stages
     WHERE id = NEW.stage_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM deal stage must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    IF parent_pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      RAISE EXCEPTION 'CRM deal stage must belong to the deal pipeline'
        USING ERRCODE = '23514';
    END IF;

    SELECT organization_id
      INTO parent_organization_id
      FROM crm_companies
     WHERE id = NEW.company_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM deal company must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.primary_contact_id IS NOT NULL THEN
      SELECT organization_id, company_id
        INTO parent_organization_id, parent_company_id
        FROM crm_contacts
       WHERE id = NEW.primary_contact_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'CRM deal primary contact must belong to the same organization and company'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.source_lead_id IS NOT NULL THEN
      SELECT organization_id, company_id
        INTO parent_organization_id, parent_company_id
        FROM crm_leads
       WHERE id = NEW.source_lead_id;

      IF parent_organization_id IS DISTINCT FROM NEW.organization_id
         OR parent_company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'CRM deal source lead must belong to the same organization and company'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'crm_deal_history' THEN
    SELECT organization_id
      INTO parent_organization_id
      FROM crm_deals
     WHERE id = NEW.deal_id;

    IF parent_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'CRM deal history deal must belong to the same organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_pipeline_stages_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_pipeline_stages
FOR EACH ROW EXECUTE FUNCTION crm_pipeline_enforce_relationship_integrity();

CREATE TRIGGER crm_deals_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_deals
FOR EACH ROW EXECUTE FUNCTION crm_pipeline_enforce_relationship_integrity();

CREATE TRIGGER crm_deal_history_relationship_integrity
BEFORE INSERT OR UPDATE ON crm_deal_history
FOR EACH ROW EXECUTE FUNCTION crm_pipeline_enforce_relationship_integrity();

-- Row-Level Security (Build 20) — all sales-pipeline records are owned
-- by Alpha Page Rankers' one platform organization: never a customer
-- organization, never shared, and never nullable. The platform-context
-- conjunct is deliberate defense-in-depth: it protects against a
-- hypothetical future bug that sets organization_id to the platform
-- organization without also correctly setting isPlatformStaff. It is
-- therefore not redundant with the equality check alone. FORCE ROW
-- LEVEL SECURITY throughout.

ALTER TABLE crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipelines FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_pipelines
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_pipelines
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_pipelines
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — CRM pipelines are archived, never hard-deleted.

ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_pipeline_stages
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_pipeline_stages
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_pipeline_stages
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — CRM pipeline stages are archived, never hard-deleted.

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_deals
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_deals
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON crm_deals
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policy — deals are retained for CRM history.

ALTER TABLE crm_deal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON crm_deal_history
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON crm_deal_history
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No UPDATE/DELETE policy — immutable, append-only, matching crm_activities.

-- Grant-layer defense-in-depth (Build 20) — the same "two independent
-- layers, neither a substitute for the other" discipline
-- `audit_events` already established (audit-security.md): RLS having
-- no DELETE policy already blocks these at the row level, but REVOKEing
-- the privilege outright means even a future bug that somehow bypassed
-- RLS (or a raw query run with FORCE RLS misconfigured) would still be
-- refused at the grant layer. Deal history is genuinely immutable, so
-- it never needs UPDATE either.
REVOKE DELETE ON crm_pipelines FROM alpha_os_app;
REVOKE DELETE ON crm_pipeline_stages FROM alpha_os_app;
REVOKE DELETE ON crm_deals FROM alpha_os_app;
REVOKE UPDATE, DELETE ON crm_deal_history FROM alpha_os_app;
