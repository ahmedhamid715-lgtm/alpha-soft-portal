-- CreateEnum
CREATE TYPE "ecommerce_store_platform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE', 'CUSTOM', 'OTHER');

-- CreateEnum
CREATE TYPE "ecommerce_store_status" AS ENUM ('PLANNING', 'IN_DEVELOPMENT', 'LIVE', 'MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ecommerce_product_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'QA', 'READY_FOR_LAUNCH', 'LIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ecommerce_product_source" AS ENUM ('MANUAL', 'IMPORT');

-- CreateTable
CREATE TABLE "ecommerce_engagements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_service_id" UUID NOT NULL,
    "project_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ecommerce_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_stores" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "ecommerce_store_platform" NOT NULL DEFAULT 'OTHER',
    "external_store_identifier" TEXT,
    "website_site_id" UUID,
    "store_url" TEXT,
    "currency" TEXT,
    "status" "ecommerce_store_status" NOT NULL DEFAULT 'PLANNING',
    "launch_target_date" DATE,
    "launched_at" TIMESTAMPTZ(3),
    "checkout_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "payment_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "payment_provider_label" TEXT,
    "shipping_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "tax_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "discounts_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "inventory_configured" "website_configuration_state" NOT NULL DEFAULT 'UNKNOWN',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ecommerce_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "external_product_id" TEXT,
    "status" "ecommerce_product_status" NOT NULL DEFAULT 'PLANNED',
    "product_type" TEXT,
    "vendor" TEXT,
    "source" "ecommerce_product_source" NOT NULL DEFAULT 'MANUAL',
    "required_for_launch" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "primary_image_url" TEXT,
    "import_batch_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ecommerce_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "external_variant_id" TEXT,
    "sku" TEXT,
    "option1_name" TEXT,
    "option1_value" TEXT,
    "option2_name" TEXT,
    "option2_value" TEXT,
    "option3_name" TEXT,
    "option3_value" TEXT,
    "price_minor_units" INTEGER,
    "compare_at_price_minor_units" INTEGER,
    "status" "ecommerce_product_status" NOT NULL DEFAULT 'PLANNED',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ecommerce_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_collections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" "ecommerce_product_status" NOT NULL DEFAULT 'PLANNED',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ecommerce_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_collection_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_collection_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecommerce_import_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "imported_by_user_id" UUID NOT NULL,
    "total_row_count" INTEGER NOT NULL,
    "imported_row_count" INTEGER NOT NULL,
    "skipped_row_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecommerce_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ecommerce_engagements_customer_service_id_key" ON "ecommerce_engagements"("customer_service_id");
CREATE INDEX "ecommerce_engagements_organization_id_idx" ON "ecommerce_engagements"("organization_id");
CREATE UNIQUE INDEX "ecommerce_stores_website_site_id_key" ON "ecommerce_stores"("website_site_id");
CREATE UNIQUE INDEX "ecommerce_stores_engagement_id_external_store_identifier_key" ON "ecommerce_stores"("engagement_id", "external_store_identifier");
CREATE INDEX "ecommerce_stores_organization_id_idx" ON "ecommerce_stores"("organization_id");
CREATE INDEX "ecommerce_stores_engagement_id_status_idx" ON "ecommerce_stores"("engagement_id", "status");
CREATE UNIQUE INDEX "ecommerce_products_store_id_external_product_id_key" ON "ecommerce_products"("store_id", "external_product_id");
CREATE UNIQUE INDEX "ecommerce_products_store_id_handle_key" ON "ecommerce_products"("store_id", "handle");
CREATE INDEX "ecommerce_products_organization_id_idx" ON "ecommerce_products"("organization_id");
CREATE INDEX "ecommerce_products_store_id_status_idx" ON "ecommerce_products"("store_id", "status");
CREATE INDEX "ecommerce_products_store_id_sort_order_created_at_idx" ON "ecommerce_products"("store_id", "sort_order", "created_at");
CREATE UNIQUE INDEX "ecommerce_variants_store_id_sku_key" ON "ecommerce_variants"("store_id", "sku");
CREATE INDEX "ecommerce_variants_organization_id_idx" ON "ecommerce_variants"("organization_id");
CREATE INDEX "ecommerce_variants_product_id_idx" ON "ecommerce_variants"("product_id");
CREATE UNIQUE INDEX "ecommerce_collections_store_id_handle_key" ON "ecommerce_collections"("store_id", "handle");
CREATE INDEX "ecommerce_collections_organization_id_idx" ON "ecommerce_collections"("organization_id");
CREATE INDEX "ecommerce_collections_store_id_idx" ON "ecommerce_collections"("store_id");
CREATE UNIQUE INDEX "ecommerce_collection_products_collection_id_product_id_key" ON "ecommerce_collection_products"("collection_id", "product_id");
CREATE INDEX "ecommerce_collection_products_organization_id_idx" ON "ecommerce_collection_products"("organization_id");
CREATE INDEX "ecommerce_collection_products_product_id_idx" ON "ecommerce_collection_products"("product_id");
CREATE INDEX "ecommerce_import_batches_organization_id_idx" ON "ecommerce_import_batches"("organization_id");
CREATE INDEX "ecommerce_import_batches_store_id_created_at_idx" ON "ecommerce_import_batches"("store_id", "created_at");

-- AddForeignKey
ALTER TABLE "ecommerce_engagements" ADD CONSTRAINT "ecommerce_engagements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_engagements" ADD CONSTRAINT "ecommerce_engagements_customer_service_id_fkey" FOREIGN KEY ("customer_service_id") REFERENCES "customer_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_engagements" ADD CONSTRAINT "ecommerce_engagements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ecommerce_engagements" ADD CONSTRAINT "ecommerce_engagements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecommerce_stores" ADD CONSTRAINT "ecommerce_stores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_stores" ADD CONSTRAINT "ecommerce_stores_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "ecommerce_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_stores" ADD CONSTRAINT "ecommerce_stores_website_site_id_fkey" FOREIGN KEY ("website_site_id") REFERENCES "website_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ecommerce_stores" ADD CONSTRAINT "ecommerce_stores_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ecommerce_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "ecommerce_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ecommerce_products" ADD CONSTRAINT "ecommerce_products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecommerce_variants" ADD CONSTRAINT "ecommerce_variants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_variants" ADD CONSTRAINT "ecommerce_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ecommerce_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_variants" ADD CONSTRAINT "ecommerce_variants_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ecommerce_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_variants" ADD CONSTRAINT "ecommerce_variants_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecommerce_collections" ADD CONSTRAINT "ecommerce_collections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_collections" ADD CONSTRAINT "ecommerce_collections_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ecommerce_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_collections" ADD CONSTRAINT "ecommerce_collections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ecommerce_collection_products" ADD CONSTRAINT "ecommerce_collection_products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_collection_products" ADD CONSTRAINT "ecommerce_collection_products_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "ecommerce_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_collection_products" ADD CONSTRAINT "ecommerce_collection_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ecommerce_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_import_batches" ADD CONSTRAINT "ecommerce_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_import_batches" ADD CONSTRAINT "ecommerce_import_batches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ecommerce_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ecommerce_import_batches" ADD CONSTRAINT "ecommerce_import_batches_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express these validation constraints.
ALTER TABLE ecommerce_stores ADD CONSTRAINT ecommerce_stores_name_non_blank_check
  CHECK (NULLIF(BTRIM(name), '') IS NOT NULL);
ALTER TABLE ecommerce_products ADD CONSTRAINT ecommerce_products_title_non_blank_check
  CHECK (NULLIF(BTRIM(title), '') IS NOT NULL);
ALTER TABLE ecommerce_variants ADD CONSTRAINT ecommerce_variants_title_non_blank_check
  CHECK (NULLIF(BTRIM(title), '') IS NOT NULL);
ALTER TABLE ecommerce_collections ADD CONSTRAINT ecommerce_collections_title_non_blank_check
  CHECK (NULLIF(BTRIM(title), '') IS NOT NULL);
ALTER TABLE ecommerce_variants ADD CONSTRAINT ecommerce_variants_price_non_negative_check
  CHECK ((price_minor_units IS NULL OR price_minor_units >= 0) AND (compare_at_price_minor_units IS NULL OR compare_at_price_minor_units >= 0));
ALTER TABLE ecommerce_variants ADD CONSTRAINT ecommerce_variants_compare_at_price_check
  CHECK (compare_at_price_minor_units IS NULL OR price_minor_units IS NULL OR compare_at_price_minor_units >= price_minor_units);
ALTER TABLE ecommerce_import_batches ADD CONSTRAINT ecommerce_import_batches_row_counts_check
  CHECK (total_row_count >= 0 AND imported_row_count >= 0 AND skipped_row_count >= 0 AND imported_row_count + skipped_row_count <= total_row_count);

-- Enforce ECOMMERCE service-category eligibility.
CREATE FUNCTION ecommerce_engagements_enforce_relationship_integrity()
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

  IF service_category_value IS DISTINCT FROM 'ECOMMERCE'::service_category THEN
    RAISE EXCEPTION 'Ecommerce engagement''s customer service must use a service definition with category ECOMMERCE'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_engagements_relationship_integrity
BEFORE INSERT OR UPDATE ON ecommerce_engagements
FOR EACH ROW EXECUTE FUNCTION ecommerce_engagements_enforce_relationship_integrity();

-- Enforce organization integrity and prevent linking a store to a website
-- belonging to a different customer, including within one platform tenant.
CREATE FUNCTION ecommerce_dev_ecommerce_stores_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  engagement_id_value UUID;
  website_site_id_value UUID;
  own_customer_organization_id_value UUID;
  own_company_id_value UUID;
  site_organization_id_value UUID;
  site_customer_organization_id_value UUID;
  site_company_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  engagement_id_value := (to_jsonb(NEW) ->> 'engagement_id')::UUID;
  website_site_id_value := (to_jsonb(NEW) ->> 'website_site_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ecommerce_engagements
   WHERE id = engagement_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Ecommerce store organization must match its engagement organization'
      USING ERRCODE = '23514';
  END IF;

  IF website_site_id_value IS NOT NULL THEN
    SELECT cs.customer_organization_id, cs.company_id
      INTO own_customer_organization_id_value, own_company_id_value
      FROM ecommerce_engagements ee
      JOIN customer_services cs ON cs.id = ee.customer_service_id
     WHERE ee.id = engagement_id_value;

    SELECT ws.organization_id, cs.customer_organization_id, cs.company_id
      INTO site_organization_id_value, site_customer_organization_id_value, site_company_id_value
      FROM website_sites ws
      JOIN website_engagements we ON we.id = ws.engagement_id
      JOIN customer_services cs ON cs.id = we.customer_service_id
     WHERE ws.id = website_site_id_value;

    IF site_organization_id_value IS DISTINCT FROM organization_id_value THEN
      RAISE EXCEPTION 'Ecommerce store organization must match its linked website site organization'
        USING ERRCODE = '23514';
    END IF;

    IF site_customer_organization_id_value IS DISTINCT FROM own_customer_organization_id_value
       OR site_company_id_value IS DISTINCT FROM own_company_id_value THEN
      RAISE EXCEPTION 'Ecommerce store and linked website site must belong to the same customer and company'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_dev_ecommerce_stores_organization_integrity
BEFORE INSERT OR UPDATE ON ecommerce_stores
FOR EACH ROW EXECUTE FUNCTION ecommerce_dev_ecommerce_stores_enforce_organization_integrity();

CREATE FUNCTION ecommerce_dev_ecommerce_products_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  store_id_value UUID;
  import_batch_id_value UUID;
  batch_organization_id_value UUID;
  batch_store_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  store_id_value := (to_jsonb(NEW) ->> 'store_id')::UUID;
  import_batch_id_value := (to_jsonb(NEW) ->> 'import_batch_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ecommerce_stores
   WHERE id = store_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Ecommerce product organization must match its store organization'
      USING ERRCODE = '23514';
  END IF;

  IF import_batch_id_value IS NOT NULL THEN
    SELECT organization_id, store_id
      INTO batch_organization_id_value, batch_store_id_value
      FROM ecommerce_import_batches
     WHERE id = import_batch_id_value;

    IF batch_organization_id_value IS DISTINCT FROM organization_id_value THEN
      RAISE EXCEPTION 'Ecommerce product organization must match its import batch organization'
        USING ERRCODE = '23514';
    END IF;

    IF batch_store_id_value IS DISTINCT FROM store_id_value THEN
      RAISE EXCEPTION 'Ecommerce product import batch must belong to the same store'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_dev_ecommerce_products_organization_integrity
BEFORE INSERT OR UPDATE ON ecommerce_products
FOR EACH ROW EXECUTE FUNCTION ecommerce_dev_ecommerce_products_enforce_organization_integrity();

CREATE FUNCTION ecommerce_dev_ecommerce_variants_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  product_id_value UUID;
  store_id_value UUID;
  parent_organization_id_value UUID;
  product_store_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  product_id_value := (to_jsonb(NEW) ->> 'product_id')::UUID;
  store_id_value := (to_jsonb(NEW) ->> 'store_id')::UUID;

  SELECT organization_id, store_id
    INTO parent_organization_id_value, product_store_id_value
    FROM ecommerce_products
   WHERE id = product_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Ecommerce variant organization must match its product organization'
      USING ERRCODE = '23514';
  END IF;

  IF product_store_id_value IS DISTINCT FROM store_id_value THEN
    RAISE EXCEPTION 'Ecommerce variant store must match its product store'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_dev_ecommerce_variants_organization_integrity
BEFORE INSERT OR UPDATE ON ecommerce_variants
FOR EACH ROW EXECUTE FUNCTION ecommerce_dev_ecommerce_variants_enforce_organization_integrity();

CREATE FUNCTION ecommerce_dev_ecommerce_collections_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  store_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  store_id_value := (to_jsonb(NEW) ->> 'store_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ecommerce_stores
   WHERE id = store_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Ecommerce collection organization must match its store organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_dev_ecommerce_collections_organization_integrity
BEFORE INSERT OR UPDATE ON ecommerce_collections
FOR EACH ROW EXECUTE FUNCTION ecommerce_dev_ecommerce_collections_enforce_organization_integrity();

CREATE FUNCTION ecommerce_dev_ecommerce_collection_products_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  collection_id_value UUID;
  product_id_value UUID;
  collection_organization_id_value UUID;
  collection_store_id_value UUID;
  product_store_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  collection_id_value := (to_jsonb(NEW) ->> 'collection_id')::UUID;
  product_id_value := (to_jsonb(NEW) ->> 'product_id')::UUID;

  SELECT organization_id, store_id
    INTO collection_organization_id_value, collection_store_id_value
    FROM ecommerce_collections
   WHERE id = collection_id_value;

  IF collection_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Ecommerce collection product organization must match its collection organization'
      USING ERRCODE = '23514';
  END IF;

  SELECT store_id
    INTO product_store_id_value
    FROM ecommerce_products
   WHERE id = product_id_value;

  IF product_store_id_value IS DISTINCT FROM collection_store_id_value THEN
    RAISE EXCEPTION 'Ecommerce collection product must reference a product from the same store as its collection'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_dev_ecommerce_collection_products_organization_integrity
BEFORE INSERT OR UPDATE ON ecommerce_collection_products
FOR EACH ROW EXECUTE FUNCTION ecommerce_dev_ecommerce_collection_products_enforce_organization_integrity();

CREATE FUNCTION ecommerce_dev_ecommerce_import_batches_enforce_organization_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  organization_id_value UUID;
  parent_organization_id_value UUID;
  store_id_value UUID;
BEGIN
  organization_id_value := (to_jsonb(NEW) ->> 'organization_id')::UUID;
  store_id_value := (to_jsonb(NEW) ->> 'store_id')::UUID;

  SELECT organization_id
    INTO parent_organization_id_value
    FROM ecommerce_stores
   WHERE id = store_id_value;

  IF parent_organization_id_value IS DISTINCT FROM organization_id_value THEN
    RAISE EXCEPTION 'Ecommerce import batch organization must match its store organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ecommerce_dev_ecommerce_import_batches_organization_integrity
BEFORE INSERT OR UPDATE ON ecommerce_import_batches
FOR EACH ROW EXECUTE FUNCTION ecommerce_dev_ecommerce_import_batches_enforce_organization_integrity();

-- Force tenant isolation on every E-Commerce Development table.
ALTER TABLE ecommerce_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_engagements FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_engagements FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ecommerce_engagements FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ecommerce_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_stores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_stores FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_stores FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ecommerce_stores FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ecommerce_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_products FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_products FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ecommerce_products FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ecommerce_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_variants FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_variants FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ecommerce_variants FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ecommerce_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_collections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_collections FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_collections FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ecommerce_collections FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ecommerce_collection_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_collection_products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_collection_products FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_collection_products FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_update ON ecommerce_collection_products FOR UPDATE USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context()) WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());

ALTER TABLE ecommerce_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON ecommerce_import_batches FOR SELECT USING (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
CREATE POLICY tenant_isolation_insert ON ecommerce_import_batches FOR INSERT WITH CHECK (organization_id = tenant_current_organization_id() AND tenant_is_platform_context());
-- Intentionally no UPDATE policy: import batches are append-only evidence.

-- No DELETE policies: all E-Commerce Development history is retained.
REVOKE DELETE ON ecommerce_engagements FROM alpha_os_app;
REVOKE DELETE ON ecommerce_stores FROM alpha_os_app;
REVOKE DELETE ON ecommerce_products FROM alpha_os_app;
REVOKE DELETE ON ecommerce_variants FROM alpha_os_app;
REVOKE DELETE ON ecommerce_collections FROM alpha_os_app;
REVOKE DELETE ON ecommerce_collection_products FROM alpha_os_app;
REVOKE DELETE ON ecommerce_import_batches FROM alpha_os_app;

-- Defense in depth for append-only import evidence.
REVOKE UPDATE ON ecommerce_import_batches FROM alpha_os_app;
