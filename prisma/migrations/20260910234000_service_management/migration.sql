-- CreateEnum
CREATE TYPE "service_category" AS ENUM ('SEO', 'LOCAL_SEO', 'WEB_DEVELOPMENT', 'ECOMMERCE', 'GHL_AUTOMATION', 'CREATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "service_delivery_cadence" AS ENUM ('ONE_TIME', 'RECURRING', 'ONGOING');

-- CreateEnum
CREATE TYPE "service_definition_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "customer_service_status" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "service_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" "service_category" NOT NULL,
    "delivery_cadence" "service_delivery_cadence" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "service_definition_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_definition_id" UUID NOT NULL,
    "source_onboarding_service_item_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "customer_service_status" NOT NULL DEFAULT 'PENDING',
    "owner_user_id" UUID,
    "start_date" TIMESTAMPTZ(3),
    "target_end_date" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_services_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "customer_service_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "service_definitions_organization_id_code_key" ON "service_definitions"("organization_id", "code");

-- CreateIndex
CREATE INDEX "service_definitions_organization_id_status_sort_order_idx" ON "service_definitions"("organization_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "service_definitions_organization_id_category_idx" ON "service_definitions"("organization_id", "category");

-- CreateIndex
CREATE INDEX "customer_services_organization_id_customer_organization_id__idx" ON "customer_services"("organization_id", "customer_organization_id", "status");

-- CreateIndex
CREATE INDEX "customer_services_organization_id_status_created_at_idx" ON "customer_services"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "customer_services_company_id_status_idx" ON "customer_services"("company_id", "status");

-- CreateIndex
CREATE INDEX "customer_services_service_definition_id_idx" ON "customer_services"("service_definition_id");

-- CreateIndex
CREATE INDEX "customer_services_owner_user_id_status_idx" ON "customer_services"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "projects_customer_service_id_idx" ON "projects"("customer_service_id");

-- AddForeignKey
ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_customer_organization_id_fkey" FOREIGN KEY ("customer_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_service_definition_id_fkey" FOREIGN KEY ("service_definition_id") REFERENCES "service_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_source_onboarding_service_item_id_fkey" FOREIGN KEY ("source_onboarding_service_item_id") REFERENCES "crm_client_onboarding_service_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_services" ADD CONSTRAINT "customer_services_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_service_id_fkey" FOREIGN KEY ("customer_service_id") REFERENCES "customer_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE customer_services ADD CONSTRAINT customer_services_cancelled_reason_required_check
  CHECK ((cancelled_at IS NULL) OR (NULLIF(BTRIM(cancelled_reason), '') IS NOT NULL));

ALTER TABLE service_definitions ADD CONSTRAINT service_definitions_code_non_blank_check
  CHECK (NULLIF(BTRIM(code), '') IS NOT NULL);

-- Prisma cannot express this filtered unique index. A cancelled provisioning
-- is historical and does not block a fresh attempt for the same source item.
CREATE UNIQUE INDEX customer_services_one_active_per_source_item
  ON customer_services(source_onboarding_service_item_id)
  WHERE source_onboarding_service_item_id IS NOT NULL AND status != 'CANCELLED';

-- RLS validates each row's platform organization. This trigger additionally
-- prevents cross-customer links that single-column foreign keys cannot prevent.
CREATE FUNCTION customer_services_enforce_relationship_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  source_service_item_id_value UUID;
  customer_organization_id_value UUID;
  company_id_value UUID;
  service_item_onboarding_id UUID;
  onboarding_customer_organization_id UUID;
  onboarding_company_id UUID;
  company_customer_organization_id UUID;
BEGIN
  source_service_item_id_value := (to_jsonb(NEW) ->> 'source_onboarding_service_item_id')::UUID;
  customer_organization_id_value := (to_jsonb(NEW) ->> 'customer_organization_id')::UUID;
  company_id_value := (to_jsonb(NEW) ->> 'company_id')::UUID;

  IF source_service_item_id_value IS NOT NULL THEN
    SELECT onboarding_id
      INTO service_item_onboarding_id
      FROM crm_client_onboarding_service_items
     WHERE id = source_service_item_id_value;

    SELECT linked_organization_id, company_id
      INTO onboarding_customer_organization_id, onboarding_company_id
      FROM crm_client_onboardings
     WHERE id = service_item_onboarding_id;

    IF onboarding_customer_organization_id IS DISTINCT FROM customer_organization_id_value
       OR onboarding_company_id IS DISTINCT FROM company_id_value THEN
      RAISE EXCEPTION 'Customer service source onboarding service item must belong to the same customer organization and company'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT converted_to_organization_id
    INTO company_customer_organization_id
    FROM crm_companies
   WHERE id = company_id_value;

  IF company_customer_organization_id IS DISTINCT FROM customer_organization_id_value THEN
    RAISE EXCEPTION 'Customer service company must be converted to the same customer organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_services_relationship_integrity
BEFORE INSERT OR UPDATE ON customer_services
FOR EACH ROW EXECUTE FUNCTION customer_services_enforce_relationship_integrity();

ALTER TABLE service_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON service_definitions
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON service_definitions
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON service_definitions
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE customer_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_services FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON customer_services
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON customer_services
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON customer_services
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

-- No DELETE policies — service definitions and customer services are retained.
REVOKE DELETE ON service_definitions FROM alpha_os_app;
REVOKE DELETE ON customer_services FROM alpha_os_app;
