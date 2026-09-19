-- CreateEnum
CREATE TYPE "ghl_workspace_status" AS ENUM ('PLANNING', 'IN_DEVELOPMENT', 'LIVE', 'MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ghl_handoff_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ghl_asset_type" AS ENUM ('FUNNEL', 'FORM', 'SURVEY', 'CALENDAR', 'PIPELINE', 'WORKFLOW', 'TRIGGER', 'CUSTOM_FIELD', 'EMAIL_TEMPLATE', 'SMS_TEMPLATE', 'SNAPSHOT', 'OTHER');

-- CreateEnum
CREATE TYPE "ghl_asset_implementation_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'READY_FOR_QA', 'QA_FAILED', 'READY', 'LIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ghl_asset_source" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "ghl_integration_requirement_status" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "ghl_automation_engagements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_service_id" UUID NOT NULL,
    "project_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ghl_automation_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ghl_workspaces" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "external_location_id" VARCHAR(200),
    "location_url" VARCHAR(2048),
    "status" "ghl_workspace_status" NOT NULL DEFAULT 'PLANNING',
    "go_live_target_date" DATE,
    "go_live_recorded_at" TIMESTAMPTZ(3),
    "handoff_status" "ghl_handoff_status" NOT NULL DEFAULT 'NOT_STARTED',
    "handoff_recorded_at" TIMESTAMPTZ(3),
    "handoff_notes" VARCHAR(5000),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ghl_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ghl_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "asset_type" "ghl_asset_type" NOT NULL,
    "name" TEXT NOT NULL,
    "external_asset_id" VARCHAR(200),
    "implementation_status" "ghl_asset_implementation_status" NOT NULL DEFAULT 'PLANNED',
    "source" "ghl_asset_source" NOT NULL DEFAULT 'MANUAL',
    "required_for_launch" BOOLEAN NOT NULL DEFAULT true,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(5000),
    "import_batch_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ghl_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ghl_integration_requirements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ghl_integration_requirement_status" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "external_system_label" VARCHAR(200),
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(2000),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ghl_integration_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ghl_import_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "imported_by_user_id" UUID NOT NULL,
    "total_row_count" INTEGER NOT NULL,
    "imported_row_count" INTEGER NOT NULL,
    "skipped_row_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ghl_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ghl_automation_engagements_customer_service_id_key" ON "ghl_automation_engagements"("customer_service_id");
CREATE INDEX "ghl_automation_engagements_organization_id_created_at_idx" ON "ghl_automation_engagements"("organization_id", "created_at");
CREATE UNIQUE INDEX "ghl_workspaces_engagement_id_external_location_id_key" ON "ghl_workspaces"("engagement_id", "external_location_id");
CREATE INDEX "ghl_workspaces_engagement_id_status_idx" ON "ghl_workspaces"("engagement_id", "status");
CREATE INDEX "ghl_workspaces_engagement_id_created_at_idx" ON "ghl_workspaces"("engagement_id", "created_at");
CREATE UNIQUE INDEX "ghl_assets_workspace_id_external_asset_id_key" ON "ghl_assets"("workspace_id", "external_asset_id");
CREATE INDEX "ghl_assets_workspace_id_asset_type_idx" ON "ghl_assets"("workspace_id", "asset_type");
CREATE INDEX "ghl_assets_workspace_id_implementation_status_idx" ON "ghl_assets"("workspace_id", "implementation_status");
CREATE INDEX "ghl_assets_workspace_id_required_for_launch_implementation_status_idx" ON "ghl_assets"("workspace_id", "required_for_launch", "implementation_status");
CREATE INDEX "ghl_assets_workspace_id_sort_order_created_at_idx" ON "ghl_assets"("workspace_id", "sort_order", "created_at");
CREATE INDEX "ghl_assets_workspace_id_asset_type_sort_order_created_at_idx" ON "ghl_assets"("workspace_id", "asset_type", "sort_order", "created_at");
CREATE INDEX "ghl_integration_requirements_workspace_id_required_status_idx" ON "ghl_integration_requirements"("workspace_id", "required", "status");
CREATE INDEX "ghl_integration_requirements_workspace_id_created_at_idx" ON "ghl_integration_requirements"("workspace_id", "created_at");
CREATE INDEX "ghl_import_batches_workspace_id_created_at_idx" ON "ghl_import_batches"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "ghl_automation_engagements" ADD CONSTRAINT "ghl_automation_engagements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_automation_engagements" ADD CONSTRAINT "ghl_automation_engagements_customer_service_id_fkey" FOREIGN KEY ("customer_service_id") REFERENCES "customer_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_automation_engagements" ADD CONSTRAINT "ghl_automation_engagements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ghl_automation_engagements" ADD CONSTRAINT "ghl_automation_engagements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ghl_workspaces" ADD CONSTRAINT "ghl_workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_workspaces" ADD CONSTRAINT "ghl_workspaces_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "ghl_automation_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_workspaces" ADD CONSTRAINT "ghl_workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ghl_assets" ADD CONSTRAINT "ghl_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_assets" ADD CONSTRAINT "ghl_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "ghl_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_assets" ADD CONSTRAINT "ghl_assets_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "ghl_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ghl_assets" ADD CONSTRAINT "ghl_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ghl_integration_requirements" ADD CONSTRAINT "ghl_integration_requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_integration_requirements" ADD CONSTRAINT "ghl_integration_requirements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "ghl_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_integration_requirements" ADD CONSTRAINT "ghl_integration_requirements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ghl_import_batches" ADD CONSTRAINT "ghl_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_import_batches" ADD CONSTRAINT "ghl_import_batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "ghl_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ghl_import_batches" ADD CONSTRAINT "ghl_import_batches_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these validation constraints.
ALTER TABLE ghl_workspaces ADD CONSTRAINT ghl_workspaces_name_non_blank_check
  CHECK (NULLIF(BTRIM(name), '') IS NOT NULL);
ALTER TABLE ghl_assets ADD CONSTRAINT ghl_assets_name_non_blank_check
  CHECK (NULLIF(BTRIM(name), '') IS NOT NULL);
ALTER TABLE ghl_integration_requirements ADD CONSTRAINT ghl_integration_requirements_name_non_blank_check
  CHECK (NULLIF(BTRIM(name), '') IS NOT NULL);
ALTER TABLE ghl_import_batches ADD CONSTRAINT ghl_import_batches_row_counts_check
  CHECK (total_row_count >= 0 AND imported_row_count >= 0 AND skipped_row_count >= 0 AND imported_row_count + skipped_row_count <= total_row_count);

-- Enforce GHL_AUTOMATION service-category eligibility.
CREATE FUNCTION ghl_automation_engagements_enforce_relationship_integrity()
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

  IF service_category_value IS DISTINCT FROM 'GHL_AUTOMATION'::service_category THEN
    RAISE EXCEPTION 'GHL automation engagement''s customer service must use a service definition with category GHL_AUTOMATION'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_automation_engagements_relationship_integrity
BEFORE INSERT OR UPDATE ON ghl_automation_engagements
FOR EACH ROW EXECUTE FUNCTION ghl_automation_engagements_enforce_relationship_integrity();

-- Keep every child row in the immediate parent's platform organization.
CREATE FUNCTION ghl_dev_ghl_workspaces_enforce_organization_integrity()
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
    FROM ghl_automation_engagements
   WHERE id = engagement_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'GHL workspace organization must match its engagement organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_dev_ghl_workspaces_organization_integrity
BEFORE INSERT OR UPDATE ON ghl_workspaces
FOR EACH ROW EXECUTE FUNCTION ghl_dev_ghl_workspaces_enforce_organization_integrity();

CREATE FUNCTION ghl_dev_ghl_assets_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  workspace_id_value UUID;
  import_batch_id_value UUID;
  batch_organization_id_value UUID;
  batch_workspace_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  workspace_id_value := (to_jsonb(NEW) ->> 'workspace_id')::UUID;
  import_batch_id_value := (to_jsonb(NEW) ->> 'import_batch_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ghl_workspaces
   WHERE id = workspace_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'GHL asset organization must match its workspace organization'
      USING ERRCODE = '23514';
  END IF;

  IF import_batch_id_value IS NOT NULL THEN
    SELECT organization_id, workspace_id
      INTO batch_organization_id_value, batch_workspace_id_value
      FROM ghl_import_batches
     WHERE id = import_batch_id_value;

    IF batch_organization_id_value IS DISTINCT FROM organization_id_value THEN
      RAISE EXCEPTION 'GHL asset organization must match its import batch organization'
        USING ERRCODE = '23514';
    END IF;

    IF batch_workspace_id_value IS DISTINCT FROM workspace_id_value THEN
      RAISE EXCEPTION 'GHL asset import batch must belong to the same workspace'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_dev_ghl_assets_organization_integrity
BEFORE INSERT OR UPDATE ON ghl_assets
FOR EACH ROW EXECUTE FUNCTION ghl_dev_ghl_assets_enforce_organization_integrity();

CREATE FUNCTION ghl_dev_ghl_integration_requirements_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  workspace_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  workspace_id_value := (to_jsonb(NEW) ->> 'workspace_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ghl_workspaces
   WHERE id = workspace_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'GHL integration requirement organization must match its workspace organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_dev_ghl_integration_requirements_organization_integrity
BEFORE INSERT OR UPDATE ON ghl_integration_requirements
FOR EACH ROW EXECUTE FUNCTION ghl_dev_ghl_integration_requirements_enforce_organization_integrity();

CREATE FUNCTION ghl_dev_ghl_import_batches_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  workspace_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  workspace_id_value := (to_jsonb(NEW) ->> 'workspace_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ghl_workspaces
   WHERE id = workspace_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'GHL import batch organization must match its workspace organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ghl_dev_ghl_import_batches_organization_integrity
BEFORE INSERT OR UPDATE ON ghl_import_batches
FOR EACH ROW EXECUTE FUNCTION ghl_dev_ghl_import_batches_enforce_organization_integrity();

-- Force tenant isolation on every GHL Automation OS table.
ALTER TABLE ghl_automation_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_automation_engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ghl_automation_engagements FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ghl_automation_engagements FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ghl_automation_engagements FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ghl_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ghl_workspaces FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ghl_workspaces FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ghl_workspaces FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ghl_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ghl_assets FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ghl_assets FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ghl_assets FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ghl_integration_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_integration_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ghl_integration_requirements FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ghl_integration_requirements FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ghl_integration_requirements FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ghl_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ghl_import_batches FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ghl_import_batches FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
-- Intentionally no UPDATE policy: import batches are append-only evidence.

-- No DELETE policies: all GHL Automation OS delivery history is retained.
REVOKE DELETE ON ghl_automation_engagements FROM alpha_os_app;
REVOKE DELETE ON ghl_workspaces FROM alpha_os_app;
REVOKE DELETE ON ghl_assets FROM alpha_os_app;
REVOKE DELETE ON ghl_integration_requirements FROM alpha_os_app;
REVOKE DELETE ON ghl_import_batches FROM alpha_os_app;

-- Defense in depth for append-only import evidence.
REVOKE UPDATE ON ghl_import_batches FROM alpha_os_app;
