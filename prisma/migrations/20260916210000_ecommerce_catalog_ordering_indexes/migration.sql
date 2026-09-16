-- Codex Performance Engineer findings PERF-ECOM-02/PERF-ECOM-04 (Build
-- 33 — E-Commerce Development OS review), mirroring Website Development
-- OS's own PERF-02 precedent (prisma/migrations/
-- 20260915090000_website_pages_ordering_indexes) exactly: several
-- bounded, ordered reads filter on a column that already has an index
-- but do not have the ORDER BY column(s) included in that same index,
-- forcing Postgres to sort the matched rows itself instead of walking
-- an index that already produces the right order. Purely additive —
-- does not touch any existing index/constraint/table/trigger/policy.
--
-- PERF-ECOM-02 (Medium): `ecommerceProductRepository.listForStore()`'s
-- status-filtered page always orders by (sort_order ASC, created_at
-- ASC); the existing `ecommerce_products_store_id_status_idx` stops
-- short of the sort columns.
CREATE INDEX "ecommerce_products_store_id_status_sort_order_created_at_idx" ON "ecommerce_products"("store_id", "status", "sort_order", "created_at");

-- PERF-ECOM-04 (Low): `ecommerceVariantRepository.listForProduct()`
-- orders by created_at ASC; the existing `ecommerce_variants_product_id_idx`
-- has no order column.
CREATE INDEX "ecommerce_variants_product_id_created_at_idx" ON "ecommerce_variants"("product_id", "created_at");

-- PERF-ECOM-04 (Low): the remaining bounded ordered-read gaps named in
-- the review — engagement list (organization_id ORDER BY created_at
-- DESC), store list (engagement_id ORDER BY created_at), collection
-- list (store_id ORDER BY created_at), collection-product list
-- (collection_id ORDER BY sort_order).
CREATE INDEX "ecommerce_engagements_organization_id_created_at_idx" ON "ecommerce_engagements"("organization_id", "created_at");
CREATE INDEX "ecommerce_stores_engagement_id_created_at_idx" ON "ecommerce_stores"("engagement_id", "created_at");
CREATE INDEX "ecommerce_collections_store_id_created_at_idx" ON "ecommerce_collections"("store_id", "created_at");
CREATE INDEX "ecommerce_collection_products_collection_id_sort_order_idx" ON "ecommerce_collection_products"("collection_id", "sort_order");

-- Deliberately NOT added here: a `pg_trgm` GIN index for
-- `ecommerceProductRepository.listForStore()`'s optional case-insensitive
-- `title` substring search. Enabling a Postgres extension is a bigger
-- infrastructure decision than an additive B-tree index and is left as
-- a documented future option (see docs/architecture/
-- ecommerce-development-os.md "Known limitations") if catalog-search
-- performance becomes a real bottleneck at scale — the same posture
-- Website Development OS's own PERF-02 fix already took for its
-- analogous page-title search field.
