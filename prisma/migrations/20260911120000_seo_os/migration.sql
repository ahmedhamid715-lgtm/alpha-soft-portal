-- CreateEnum
CREATE TYPE "seo_search_engine" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "seo_device" AS ENUM ('DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "seo_data_source" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "seo_rank_status" AS ENUM ('RANKED', 'NOT_FOUND', 'BEYOND_TRACKED_RANGE', 'SOURCE_ERROR');

-- CreateEnum
CREATE TYPE "seo_property_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "seo_keyword_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "seo_audit_run_status" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "seo_issue_type" AS ENUM ('BROKEN_LINK', 'MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'DUPLICATE_TITLE', 'DUPLICATE_META_DESCRIPTION', 'MISSING_H1', 'SLOW_PAGE_SPEED', 'MISSING_ALT_TEXT', 'REDIRECT_CHAIN', 'NOINDEX_CONFLICT', 'THIN_CONTENT', 'MOBILE_USABILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "seo_issue_severity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "seo_issue_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "seo_engagements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_service_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seo_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_properties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "normalized_origin" TEXT NOT NULL,
    "display_url" TEXT NOT NULL,
    "target_country" CHAR(2),
    "target_locale" TEXT,
    "status" "seo_property_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seo_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keywords" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "phrase" TEXT NOT NULL,
    "normalized_phrase" TEXT NOT NULL,
    "target_url" TEXT,
    "search_engine" "seo_search_engine" NOT NULL DEFAULT 'GOOGLE',
    "device" "seo_device" NOT NULL,
    "country" CHAR(2),
    "locale" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "seo_keyword_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_import_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_rank_observations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "seo_data_source" NOT NULL,
    "rank_status" "seo_rank_status" NOT NULL,
    "position" INTEGER,
    "ranking_url" TEXT,
    "notes" TEXT,
    "import_batch_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_rank_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_audit_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "source" "seo_data_source" NOT NULL,
    "status" "seo_audit_run_status" NOT NULL DEFAULT 'COMPLETED',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "summary" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_issues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "issue_type" "seo_issue_type" NOT NULL,
    "severity" "seo_issue_severity" NOT NULL,
    "page_url" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "seo_issue_status" NOT NULL DEFAULT 'OPEN',
    "detected_by_audit_run_id" UUID,
    "first_detected_at" TIMESTAMPTZ(3) NOT NULL,
    "last_detected_at" TIMESTAMPTZ(3) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "resolution_notes" TEXT,
    "ignored_at" TIMESTAMPTZ(3),
    "ignored_by_user_id" UUID,
    "ignored_reason" TEXT,
    "linked_task_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seo_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seo_engagements_customer_service_id_key" ON "seo_engagements"("customer_service_id");

-- CreateIndex
CREATE INDEX "seo_engagements_organization_id_idx" ON "seo_engagements"("organization_id");

-- CreateIndex
CREATE INDEX "seo_properties_organization_id_idx" ON "seo_properties"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_properties_engagement_id_normalized_origin_key" ON "seo_properties"("engagement_id", "normalized_origin");

-- CreateIndex
CREATE INDEX "seo_keywords_organization_id_idx" ON "seo_keywords"("organization_id");

-- CreateIndex
CREATE INDEX "seo_keywords_property_id_status_idx" ON "seo_keywords"("property_id", "status");

-- CreateIndex
CREATE INDEX "seo_import_batches_engagement_id_created_at_idx" ON "seo_import_batches"("engagement_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "seo_rank_observations_organization_id_idx" ON "seo_rank_observations"("organization_id");

-- CreateIndex
CREATE INDEX "seo_rank_observations_keyword_id_observed_at_idx" ON "seo_rank_observations"("keyword_id", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "seo_rank_observations_keyword_id_observed_at_key" ON "seo_rank_observations"("keyword_id", "observed_at");

-- CreateIndex
CREATE INDEX "seo_audit_runs_organization_id_idx" ON "seo_audit_runs"("organization_id");

-- CreateIndex
CREATE INDEX "seo_audit_runs_property_id_started_at_idx" ON "seo_audit_runs"("property_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "seo_issues_organization_id_idx" ON "seo_issues"("organization_id");

-- CreateIndex
CREATE INDEX "seo_issues_property_id_status_idx" ON "seo_issues"("property_id", "status");

-- AddForeignKey
ALTER TABLE "seo_engagements" ADD CONSTRAINT "seo_engagements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_engagements" ADD CONSTRAINT "seo_engagements_customer_service_id_fkey" FOREIGN KEY ("customer_service_id") REFERENCES "customer_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_engagements" ADD CONSTRAINT "seo_engagements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_properties" ADD CONSTRAINT "seo_properties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_properties" ADD CONSTRAINT "seo_properties_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "seo_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_properties" ADD CONSTRAINT "seo_properties_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "seo_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_import_batches" ADD CONSTRAINT "seo_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_import_batches" ADD CONSTRAINT "seo_import_batches_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "seo_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_import_batches" ADD CONSTRAINT "seo_import_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_rank_observations" ADD CONSTRAINT "seo_rank_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_rank_observations" ADD CONSTRAINT "seo_rank_observations_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "seo_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_rank_observations" ADD CONSTRAINT "seo_rank_observations_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "seo_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_rank_observations" ADD CONSTRAINT "seo_rank_observations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit_runs" ADD CONSTRAINT "seo_audit_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit_runs" ADD CONSTRAINT "seo_audit_runs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "seo_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit_runs" ADD CONSTRAINT "seo_audit_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "seo_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_detected_by_audit_run_id_fkey" FOREIGN KEY ("detected_by_audit_run_id") REFERENCES "seo_audit_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_ignored_by_user_id_fkey" FOREIGN KEY ("ignored_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "internal_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these validation constraints.
ALTER TABLE seo_properties ADD CONSTRAINT seo_properties_normalized_origin_non_blank_check
  CHECK (NULLIF(BTRIM(normalized_origin), '') IS NOT NULL);

ALTER TABLE seo_properties ADD CONSTRAINT seo_properties_display_url_non_blank_check
  CHECK (NULLIF(BTRIM(display_url), '') IS NOT NULL);

ALTER TABLE seo_keywords ADD CONSTRAINT seo_keywords_phrase_non_blank_check
  CHECK (NULLIF(BTRIM(phrase), '') IS NOT NULL);

ALTER TABLE seo_keywords ADD CONSTRAINT seo_keywords_normalized_phrase_non_blank_check
  CHECK (NULLIF(BTRIM(normalized_phrase), '') IS NOT NULL);

ALTER TABLE seo_issues ADD CONSTRAINT seo_issues_title_non_blank_check
  CHECK (NULLIF(BTRIM(title), '') IS NOT NULL);

ALTER TABLE seo_rank_observations ADD CONSTRAINT seo_rank_observations_position_consistency_check
  CHECK ((rank_status = 'RANKED' AND position IS NOT NULL AND position > 0) OR (rank_status != 'RANKED' AND position IS NULL));

ALTER TABLE seo_issues ADD CONSTRAINT seo_issues_resolved_consistency_check
  CHECK ((resolved_at IS NULL AND resolved_by_user_id IS NULL) OR (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL));

ALTER TABLE seo_issues ADD CONSTRAINT seo_issues_ignored_consistency_check
  CHECK ((ignored_at IS NULL AND ignored_by_user_id IS NULL AND ignored_reason IS NULL) OR (ignored_at IS NOT NULL AND ignored_by_user_id IS NOT NULL AND NULLIF(BTRIM(ignored_reason), '') IS NOT NULL));

ALTER TABLE seo_issues ADD CONSTRAINT seo_issues_acknowledged_consistency_check
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by_user_id IS NULL));

ALTER TABLE seo_issues ADD CONSTRAINT seo_issues_detection_order_check
  CHECK (first_detected_at <= last_detected_at);

-- Nullable dedup dimensions require functional/partial unique indexes.
CREATE UNIQUE INDEX seo_keywords_dedup_key
  ON seo_keywords(property_id, normalized_phrase, search_engine, device, COALESCE(country, ''), COALESCE(locale, ''));

CREATE UNIQUE INDEX seo_issues_page_key
  ON seo_issues(property_id, issue_type, page_url)
  WHERE page_url IS NOT NULL;

CREATE UNIQUE INDEX seo_issues_sitewide_key
  ON seo_issues(property_id, issue_type)
  WHERE page_url IS NULL;

-- RLS validates each row's platform organization. This trigger additionally
-- enforces the service category across the CustomerService two-hop relation.
CREATE FUNCTION seo_engagements_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  customer_service_id_value UUID;
  service_definition_id_value UUID;
  service_category_value service_category;
BEGIN
  customer_service_id_value := (to_jsonb(NEW) ->> 'customer_service_id')::UUID;

  SELECT service_definition_id
    INTO service_definition_id_value
    FROM customer_services
   WHERE id = customer_service_id_value;

  SELECT category
    INTO service_category_value
    FROM service_definitions
   WHERE id = service_definition_id_value;

  IF service_category_value IS DISTINCT FROM 'SEO'::service_category THEN
    RAISE EXCEPTION 'SEO engagement''s customer service must use a service definition with category SEO'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER seo_engagements_relationship_integrity
BEFORE INSERT OR UPDATE ON seo_engagements
FOR EACH ROW EXECUTE FUNCTION seo_engagements_enforce_relationship_integrity();

ALTER TABLE seo_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_engagements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_engagements
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_engagements
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON seo_engagements
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE seo_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_properties FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_properties
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_properties
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON seo_properties
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_keywords FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_keywords
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_keywords
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON seo_keywords
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE seo_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_import_batches FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_import_batches
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_import_batches
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON seo_import_batches
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE seo_rank_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_rank_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_rank_observations
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_rank_observations
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- Intentionally no UPDATE policy: rank observations are append-only facts.

ALTER TABLE seo_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_audit_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_audit_runs
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_audit_runs
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON seo_audit_runs
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE seo_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_issues FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON seo_issues
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON seo_issues
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON seo_issues
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policies: every SEO table retains history permanently.
REVOKE DELETE ON seo_engagements FROM alpha_os_app;
REVOKE DELETE ON seo_properties FROM alpha_os_app;
REVOKE DELETE ON seo_keywords FROM alpha_os_app;
REVOKE DELETE ON seo_import_batches FROM alpha_os_app;
REVOKE DELETE ON seo_rank_observations FROM alpha_os_app;
REVOKE DELETE ON seo_audit_runs FROM alpha_os_app;
REVOKE DELETE ON seo_issues FROM alpha_os_app;

-- Defense in depth for the genuinely append-only rank fact table.
REVOKE UPDATE ON seo_rank_observations FROM alpha_os_app;
