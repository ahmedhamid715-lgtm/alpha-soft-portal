-- CreateEnum
CREATE TYPE "website_site_status" AS ENUM ('PLANNING', 'IN_DEVELOPMENT', 'LAUNCHED', 'MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "website_site_type" AS ENUM ('STANDARD', 'ECOMMERCE', 'OTHER');

-- CreateEnum
CREATE TYPE "website_platform" AS ENUM ('WORDPRESS', 'SHOPIFY', 'WEBFLOW', 'CUSTOM_NEXTJS', 'OTHER');

-- CreateEnum
CREATE TYPE "website_configuration_state" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "website_environment_type" AS ENUM ('LOCAL', 'DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "website_environment_status" AS ENUM ('NOT_SET_UP', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "website_page_type" AS ENUM ('PAGE', 'TEMPLATE', 'COMPONENT', 'OTHER');

-- CreateEnum
CREATE TYPE "website_page_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'QA', 'READY_FOR_LAUNCH', 'LIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "website_deployment_status" AS ENUM ('SUCCEEDED', 'FAILED', 'ROLLED_BACK');

-- CreateTable
CREATE TABLE "website_engagements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_service_id" UUID NOT NULL,
    "project_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "website_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "primary_url" TEXT,
    "normalized_primary_origin" TEXT,
    "site_type" "website_site_type" NOT NULL DEFAULT 'STANDARD',
    "platform" "website_platform" NOT NULL DEFAULT 'OTHER',
    "technology_notes" TEXT,
    "repository_url" TEXT,
    "analytics_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "tag_manager_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "status" "website_site_status" NOT NULL DEFAULT 'PLANNING',
    "launch_target_date" DATE,
    "launched_at" TIMESTAMPTZ(3),
    "launch_deployment_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "website_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_environments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "type" "website_environment_type" NOT NULL,
    "url" TEXT,
    "normalized_origin" TEXT,
    "status" "website_environment_status" NOT NULL DEFAULT 'NOT_SET_UP',
    "provider_label" TEXT,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "website_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "page_type" "website_page_type" NOT NULL DEFAULT 'PAGE',
    "status" "website_page_status" NOT NULL DEFAULT 'PLANNED',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "project_task_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "website_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_deployments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "environment_id" UUID NOT NULL,
    "deployed_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "website_deployment_status" NOT NULL,
    "version_label" TEXT,
    "notes" TEXT,
    "rollback_of_deployment_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_engagements_customer_service_id_key" ON "website_engagements"("customer_service_id");
CREATE INDEX "website_engagements_organization_id_idx" ON "website_engagements"("organization_id");
CREATE INDEX "website_sites_organization_id_idx" ON "website_sites"("organization_id");
CREATE INDEX "website_sites_engagement_id_status_idx" ON "website_sites"("engagement_id", "status");
CREATE INDEX "website_environments_organization_id_idx" ON "website_environments"("organization_id");
CREATE UNIQUE INDEX "website_environments_site_id_type_key" ON "website_environments"("site_id", "type");
CREATE INDEX "website_pages_organization_id_idx" ON "website_pages"("organization_id");
CREATE INDEX "website_pages_site_id_status_idx" ON "website_pages"("site_id", "status");
CREATE UNIQUE INDEX "website_pages_site_id_path_key" ON "website_pages"("site_id", "path");
CREATE INDEX "website_deployments_organization_id_idx" ON "website_deployments"("organization_id");
CREATE INDEX "website_deployments_site_id_deployed_at_idx" ON "website_deployments"("site_id", "deployed_at" DESC);
CREATE INDEX "website_deployments_environment_id_deployed_at_idx" ON "website_deployments"("environment_id", "deployed_at" DESC);

-- AddForeignKey
ALTER TABLE "website_engagements" ADD CONSTRAINT "website_engagements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_engagements" ADD CONSTRAINT "website_engagements_customer_service_id_fkey" FOREIGN KEY ("customer_service_id") REFERENCES "customer_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_engagements" ADD CONSTRAINT "website_engagements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "website_engagements" ADD CONSTRAINT "website_engagements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "website_sites" ADD CONSTRAINT "website_sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_sites" ADD CONSTRAINT "website_sites_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "website_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_sites" ADD CONSTRAINT "website_sites_launch_deployment_id_fkey" FOREIGN KEY ("launch_deployment_id") REFERENCES "website_deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "website_sites" ADD CONSTRAINT "website_sites_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "website_environments" ADD CONSTRAINT "website_environments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_environments" ADD CONSTRAINT "website_environments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "website_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_environments" ADD CONSTRAINT "website_environments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "website_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_project_task_id_fkey" FOREIGN KEY ("project_task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "website_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "website_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_rollback_of_deployment_id_fkey" FOREIGN KEY ("rollback_of_deployment_id") REFERENCES "website_deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "website_deployments" ADD CONSTRAINT "website_deployments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these validation constraints.
ALTER TABLE website_sites ADD CONSTRAINT website_sites_name_non_blank_check
  CHECK (NULLIF(BTRIM(name), '') IS NOT NULL);
ALTER TABLE website_pages ADD CONSTRAINT website_pages_title_non_blank_check
  CHECK (NULLIF(BTRIM(title), '') IS NOT NULL);
ALTER TABLE website_pages ADD CONSTRAINT website_pages_path_check
  CHECK (path LIKE '/%' AND NULLIF(BTRIM(path), '') IS NOT NULL);
ALTER TABLE website_deployments ADD CONSTRAINT website_deployments_rollback_not_self_check
  CHECK (rollback_of_deployment_id IS NULL OR rollback_of_deployment_id != id);

-- A nullable canonical origin only participates in deduplication when known.
CREATE UNIQUE INDEX website_sites_engagement_id_normalized_origin_key
  ON website_sites(engagement_id, normalized_primary_origin)
  WHERE normalized_primary_origin IS NOT NULL;

-- RLS validates each row's platform organization. This trigger additionally
-- enforces the WEB_DEVELOPMENT service category across the CustomerService two-hop relation.
CREATE FUNCTION website_engagements_enforce_relationship_integrity()
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

  IF service_category_value IS DISTINCT FROM 'WEB_DEVELOPMENT'::service_category THEN
    RAISE EXCEPTION 'Website engagement''s customer service must use a service definition with category WEB_DEVELOPMENT'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER website_engagements_relationship_integrity
BEFORE INSERT OR UPDATE ON website_engagements
FOR EACH ROW EXECUTE FUNCTION website_engagements_enforce_relationship_integrity();

-- Enforce same-organization relationships at the database layer from the
-- initial Website Development OS migration.
CREATE FUNCTION website_dev_website_sites_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  engagement_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  engagement_id_value := (to_jsonb(NEW) ->> 'engagement_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_engagements
   WHERE id = engagement_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website site organization must match its engagement organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER website_dev_website_sites_organization_integrity
BEFORE INSERT OR UPDATE ON website_sites
FOR EACH ROW EXECUTE FUNCTION website_dev_website_sites_enforce_organization_integrity();

CREATE FUNCTION website_dev_website_environments_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  site_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  site_id_value := (to_jsonb(NEW) ->> 'site_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_sites
   WHERE id = site_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website environment organization must match its site organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER website_dev_website_environments_organization_integrity
BEFORE INSERT OR UPDATE ON website_environments
FOR EACH ROW EXECUTE FUNCTION website_dev_website_environments_enforce_organization_integrity();

CREATE FUNCTION website_dev_website_pages_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  site_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  site_id_value := (to_jsonb(NEW) ->> 'site_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_sites
   WHERE id = site_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website page organization must match its site organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER website_dev_website_pages_organization_integrity
BEFORE INSERT OR UPDATE ON website_pages
FOR EACH ROW EXECUTE FUNCTION website_dev_website_pages_enforce_organization_integrity();

CREATE FUNCTION website_dev_website_deployments_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  site_id_value UUID;
  environment_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  site_id_value := (to_jsonb(NEW) ->> 'site_id')::UUID;
  environment_id_value := (to_jsonb(NEW) ->> 'environment_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_sites
   WHERE id = site_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website deployment organization must match its site organization'
      USING ERRCODE = '23514';
  END IF;

  parent_organization_id_value := NULL;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM website_environments
   WHERE id = environment_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Website deployment organization must match its environment organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER website_dev_website_deployments_organization_integrity
BEFORE INSERT OR UPDATE ON website_deployments
FOR EACH ROW EXECUTE FUNCTION website_dev_website_deployments_enforce_organization_integrity();

-- Force tenant isolation on every Website Development OS table.
ALTER TABLE website_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON website_engagements FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON website_engagements FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON website_engagements FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE website_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON website_sites FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON website_sites FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON website_sites FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE website_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_environments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON website_environments FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON website_environments FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON website_environments FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE website_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON website_pages FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON website_pages FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON website_pages FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE website_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_deployments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON website_deployments FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON website_deployments FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
-- Intentionally no UPDATE policy: deployments are append-only evidence.

-- No DELETE policies: every Website Development OS table retains history permanently.
REVOKE DELETE ON website_engagements FROM alpha_os_app;
REVOKE DELETE ON website_sites FROM alpha_os_app;
REVOKE DELETE ON website_environments FROM alpha_os_app;
REVOKE DELETE ON website_pages FROM alpha_os_app;
REVOKE DELETE ON website_deployments FROM alpha_os_app;

-- Defense in depth for the genuinely append-only deployment fact table.
REVOKE UPDATE ON website_deployments FROM alpha_os_app;
