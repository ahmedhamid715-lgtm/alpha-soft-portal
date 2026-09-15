-- CreateEnum
CREATE TYPE "local_seo_data_source" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "local_seo_location_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "local_seo_verification_state" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NOT_MEASURED');

-- CreateEnum
CREATE TYPE "local_seo_device" AS ENUM ('DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "local_seo_search_surface" AS ENUM ('LOCAL_PACK');

-- CreateEnum
CREATE TYPE "local_rank_status" AS ENUM ('RANKED', 'NOT_FOUND', 'BEYOND_TRACKED_RANGE', 'SOURCE_ERROR');

-- CreateEnum
CREATE TYPE "local_seo_keyword_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "local_seo_review_response_status" AS ENUM ('NONE', 'DRAFTED', 'RESPONDED');

-- CreateEnum
CREATE TYPE "local_seo_audit_run_status" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "local_seo_issue_type" AS ENUM ('NAP_INCONSISTENCY', 'MISSING_LISTING', 'PROFILE_INCOMPLETE', 'UNVERIFIED_PROFILE', 'REVIEW_RESPONSE_BACKLOG', 'OTHER');

-- CreateEnum
CREATE TYPE "local_seo_issue_severity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "local_seo_issue_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "local_seo_engagements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_service_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "local_seo_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_seo_locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "businessName" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" CHAR(2),
    "phone" TEXT,
    "websiteUrl" TEXT,
    "normalized_website_origin" TEXT,
    "service_area_business" BOOLEAN NOT NULL DEFAULT false,
    "status" "local_seo_location_status" NOT NULL DEFAULT 'ACTIVE',
    "source" "local_seo_data_source" NOT NULL DEFAULT 'MANUAL',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "local_seo_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gbp_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "external_profile_id" TEXT,
    "profile_url" TEXT,
    "primary_category" TEXT,
    "secondary_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verification_state" "local_seo_verification_state" NOT NULL DEFAULT 'NOT_MEASURED',
    "observed_status" TEXT,
    "last_observed_at" TIMESTAMPTZ(3),
    "source" "local_seo_data_source" NOT NULL DEFAULT 'MANUAL',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "gbp_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_seo_keywords" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "phrase" TEXT NOT NULL,
    "normalized_phrase" TEXT NOT NULL,
    "search_surface" "local_seo_search_surface" NOT NULL DEFAULT 'LOCAL_PACK',
    "device" "local_seo_device" NOT NULL,
    "country" CHAR(2),
    "locale" TEXT,
    "search_lat" DECIMAL(9,6),
    "search_lng" DECIMAL(9,6),
    "search_label" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "local_seo_keyword_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "local_seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_seo_import_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "local_seo_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_rank_observations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "local_seo_data_source" NOT NULL,
    "rank_status" "local_rank_status" NOT NULL,
    "position" INTEGER,
    "ranking_profile_url" TEXT,
    "notes" TEXT,
    "import_batch_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "local_rank_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_listings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT,
    "observed_business_name" TEXT,
    "observed_address_line1" TEXT,
    "observed_city" TEXT,
    "observed_postal_code" TEXT,
    "observed_phone" TEXT,
    "observed_website_url" TEXT,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "local_seo_data_source" NOT NULL,
    "import_batch_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "local_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "external_review_id" TEXT,
    "rating" INTEGER NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewer_display_name" TEXT,
    "text" TEXT,
    "response_status" "local_seo_review_response_status" NOT NULL DEFAULT 'NONE',
    "response_text" TEXT,
    "responded_at" TIMESTAMPTZ(3),
    "responded_by_user_id" UUID,
    "source" "local_seo_data_source" NOT NULL,
    "import_batch_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "local_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_seo_audit_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "source" "local_seo_data_source" NOT NULL,
    "status" "local_seo_audit_run_status" NOT NULL DEFAULT 'COMPLETED',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "summary" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "local_seo_audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_seo_issues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "issue_type" "local_seo_issue_type" NOT NULL,
    "severity" "local_seo_issue_severity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "local_seo_issue_status" NOT NULL DEFAULT 'OPEN',
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
    CONSTRAINT "local_seo_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_seo_engagements_customer_service_id_key" ON "local_seo_engagements"("customer_service_id");
CREATE INDEX "local_seo_engagements_organization_id_idx" ON "local_seo_engagements"("organization_id");
CREATE INDEX "local_seo_locations_organization_id_idx" ON "local_seo_locations"("organization_id");
CREATE INDEX "local_seo_locations_engagement_id_status_idx" ON "local_seo_locations"("engagement_id", "status");
CREATE UNIQUE INDEX "gbp_profiles_location_id_key" ON "gbp_profiles"("location_id");
CREATE INDEX "gbp_profiles_organization_id_idx" ON "gbp_profiles"("organization_id");
CREATE INDEX "local_seo_keywords_organization_id_idx" ON "local_seo_keywords"("organization_id");
CREATE INDEX "local_seo_keywords_location_id_status_idx" ON "local_seo_keywords"("location_id", "status");
CREATE INDEX "local_seo_import_batches_engagement_id_created_at_idx" ON "local_seo_import_batches"("engagement_id", "created_at" DESC);
CREATE INDEX "local_rank_observations_organization_id_idx" ON "local_rank_observations"("organization_id");
CREATE INDEX "local_rank_observations_keyword_id_observed_at_idx" ON "local_rank_observations"("keyword_id", "observed_at" DESC);
CREATE UNIQUE INDEX "local_rank_observations_keyword_id_observed_at_key" ON "local_rank_observations"("keyword_id", "observed_at");
CREATE INDEX "local_listings_organization_id_idx" ON "local_listings"("organization_id");
CREATE UNIQUE INDEX "local_listings_location_id_source_name_key" ON "local_listings"("location_id", "source_name");
CREATE INDEX "local_reviews_organization_id_idx" ON "local_reviews"("organization_id");
CREATE INDEX "local_reviews_location_id_reviewed_at_idx" ON "local_reviews"("location_id", "reviewed_at" DESC);
CREATE INDEX "local_seo_audit_runs_organization_id_idx" ON "local_seo_audit_runs"("organization_id");
CREATE INDEX "local_seo_audit_runs_location_id_started_at_idx" ON "local_seo_audit_runs"("location_id", "started_at" DESC);
CREATE INDEX "local_seo_issues_organization_id_idx" ON "local_seo_issues"("organization_id");
CREATE INDEX "local_seo_issues_location_id_status_idx" ON "local_seo_issues"("location_id", "status");

-- AddForeignKey
ALTER TABLE "local_seo_engagements" ADD CONSTRAINT "local_seo_engagements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_engagements" ADD CONSTRAINT "local_seo_engagements_customer_service_id_fkey" FOREIGN KEY ("customer_service_id") REFERENCES "customer_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_engagements" ADD CONSTRAINT "local_seo_engagements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_seo_locations" ADD CONSTRAINT "local_seo_locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_locations" ADD CONSTRAINT "local_seo_locations_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "local_seo_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_locations" ADD CONSTRAINT "local_seo_locations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gbp_profiles" ADD CONSTRAINT "gbp_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gbp_profiles" ADD CONSTRAINT "gbp_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "local_seo_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gbp_profiles" ADD CONSTRAINT "gbp_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_seo_keywords" ADD CONSTRAINT "local_seo_keywords_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_keywords" ADD CONSTRAINT "local_seo_keywords_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "local_seo_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_keywords" ADD CONSTRAINT "local_seo_keywords_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_seo_import_batches" ADD CONSTRAINT "local_seo_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_import_batches" ADD CONSTRAINT "local_seo_import_batches_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "local_seo_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_import_batches" ADD CONSTRAINT "local_seo_import_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_rank_observations" ADD CONSTRAINT "local_rank_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_rank_observations" ADD CONSTRAINT "local_rank_observations_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "local_seo_keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_rank_observations" ADD CONSTRAINT "local_rank_observations_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "local_seo_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_rank_observations" ADD CONSTRAINT "local_rank_observations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_listings" ADD CONSTRAINT "local_listings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_listings" ADD CONSTRAINT "local_listings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "local_seo_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_listings" ADD CONSTRAINT "local_listings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_reviews" ADD CONSTRAINT "local_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_reviews" ADD CONSTRAINT "local_reviews_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "local_seo_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_reviews" ADD CONSTRAINT "local_reviews_responded_by_user_id_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_reviews" ADD CONSTRAINT "local_reviews_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_seo_audit_runs" ADD CONSTRAINT "local_seo_audit_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_audit_runs" ADD CONSTRAINT "local_seo_audit_runs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "local_seo_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_audit_runs" ADD CONSTRAINT "local_seo_audit_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "local_seo_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_detected_by_audit_run_id_fkey" FOREIGN KEY ("detected_by_audit_run_id") REFERENCES "local_seo_audit_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_ignored_by_user_id_fkey" FOREIGN KEY ("ignored_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "internal_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "local_seo_issues" ADD CONSTRAINT "local_seo_issues_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these validation constraints.
ALTER TABLE local_seo_locations ADD CONSTRAINT local_seo_locations_business_name_non_blank_check
  CHECK (NULLIF(BTRIM("businessName"), '') IS NOT NULL);
ALTER TABLE local_seo_keywords ADD CONSTRAINT local_seo_keywords_phrase_non_blank_check
  CHECK (NULLIF(BTRIM(phrase), '') IS NOT NULL);
ALTER TABLE local_seo_keywords ADD CONSTRAINT local_seo_keywords_normalized_phrase_non_blank_check
  CHECK (NULLIF(BTRIM(normalized_phrase), '') IS NOT NULL);
ALTER TABLE local_listings ADD CONSTRAINT local_listings_source_name_non_blank_check
  CHECK (NULLIF(BTRIM(source_name), '') IS NOT NULL);
ALTER TABLE local_seo_issues ADD CONSTRAINT local_seo_issues_title_non_blank_check
  CHECK (NULLIF(BTRIM(title), '') IS NOT NULL);
ALTER TABLE local_seo_keywords ADD CONSTRAINT local_seo_keywords_coordinates_check
  CHECK ((search_lat IS NULL AND search_lng IS NULL) OR (search_lat BETWEEN -90 AND 90 AND search_lng BETWEEN -180 AND 180));
ALTER TABLE local_rank_observations ADD CONSTRAINT local_rank_observations_position_consistency_check
  CHECK ((rank_status = 'RANKED' AND position IS NOT NULL AND position > 0) OR (rank_status != 'RANKED' AND position IS NULL));
ALTER TABLE local_reviews ADD CONSTRAINT local_reviews_rating_check
  CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE local_reviews ADD CONSTRAINT local_reviews_response_consistency_check
  CHECK ((response_status = 'NONE' AND responded_at IS NULL AND responded_by_user_id IS NULL) OR (response_status = 'DRAFTED' AND responded_at IS NULL AND responded_by_user_id IS NULL) OR (response_status = 'RESPONDED' AND responded_at IS NOT NULL AND responded_by_user_id IS NOT NULL));
ALTER TABLE local_seo_issues ADD CONSTRAINT local_seo_issues_resolved_consistency_check
  CHECK ((resolved_at IS NULL AND resolved_by_user_id IS NULL) OR (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL));
ALTER TABLE local_seo_issues ADD CONSTRAINT local_seo_issues_ignored_consistency_check
  CHECK ((ignored_at IS NULL AND ignored_by_user_id IS NULL AND ignored_reason IS NULL) OR (ignored_at IS NOT NULL AND ignored_by_user_id IS NOT NULL AND NULLIF(BTRIM(ignored_reason), '') IS NOT NULL));
ALTER TABLE local_seo_issues ADD CONSTRAINT local_seo_issues_acknowledged_consistency_check
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by_user_id IS NULL));
ALTER TABLE local_seo_issues ADD CONSTRAINT local_seo_issues_detection_order_check
  CHECK (first_detected_at <= last_detected_at);

-- Nullable dedup dimensions require functional/partial unique indexes.
CREATE UNIQUE INDEX local_seo_keywords_dedup_key ON local_seo_keywords(location_id, normalized_phrase, search_surface, device, COALESCE(country, ''), COALESCE(locale, ''), COALESCE(search_label, ''));
CREATE UNIQUE INDEX local_reviews_external_id_key ON local_reviews(location_id, external_review_id) WHERE external_review_id IS NOT NULL;

-- RLS validates each row's platform organization. This trigger additionally
-- enforces the LOCAL_SEO service category across the CustomerService two-hop relation.
CREATE FUNCTION local_seo_engagements_enforce_relationship_integrity()
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

  IF service_category_value IS DISTINCT FROM 'LOCAL_SEO'::service_category THEN
    RAISE EXCEPTION 'Local SEO engagement''s customer service must use a service definition with category LOCAL_SEO'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER local_seo_engagements_relationship_integrity
BEFORE INSERT OR UPDATE ON local_seo_engagements
FOR EACH ROW EXECUTE FUNCTION local_seo_engagements_enforce_relationship_integrity();

-- Force tenant isolation on every Local SEO table.
ALTER TABLE local_seo_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_seo_engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_seo_engagements FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_seo_engagements FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_seo_engagements FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_seo_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_seo_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_seo_locations FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_seo_locations FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_seo_locations FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE gbp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON gbp_profiles FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON gbp_profiles FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON gbp_profiles FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_seo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_seo_keywords FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_seo_keywords FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_seo_keywords FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_seo_keywords FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_seo_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_seo_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_seo_import_batches FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_seo_import_batches FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_seo_import_batches FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_rank_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_rank_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_rank_observations FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_rank_observations FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
-- Intentionally no UPDATE policy: rank observations are append-only facts.

ALTER TABLE local_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_listings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_listings FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_listings FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_listings FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_reviews FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_reviews FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_reviews FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_seo_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_seo_audit_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_seo_audit_runs FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_seo_audit_runs FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_seo_audit_runs FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE local_seo_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_seo_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON local_seo_issues FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON local_seo_issues FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON local_seo_issues FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policies: every Local SEO table retains history permanently.
REVOKE DELETE ON local_seo_engagements FROM alpha_os_app;
REVOKE DELETE ON local_seo_locations FROM alpha_os_app;
REVOKE DELETE ON gbp_profiles FROM alpha_os_app;
REVOKE DELETE ON local_seo_keywords FROM alpha_os_app;
REVOKE DELETE ON local_seo_import_batches FROM alpha_os_app;
REVOKE DELETE ON local_rank_observations FROM alpha_os_app;
REVOKE DELETE ON local_listings FROM alpha_os_app;
REVOKE DELETE ON local_reviews FROM alpha_os_app;
REVOKE DELETE ON local_seo_audit_runs FROM alpha_os_app;
REVOKE DELETE ON local_seo_issues FROM alpha_os_app;

-- Defense in depth for the genuinely append-only rank fact table.
REVOKE UPDATE ON local_rank_observations FROM alpha_os_app;
