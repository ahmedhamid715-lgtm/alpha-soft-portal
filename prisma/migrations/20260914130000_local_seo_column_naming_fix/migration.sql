-- Build 31 — GBP / Local SEO follow-up: the initial Local SEO migration
-- left five LocalSeoLocation columns unmapped, so Prisma materialized them
-- as quoted camelCase identifiers ("businessName", "addressLine1", etc.),
-- inconsistent with every other table in this schema (snake_case columns
-- via @map). Table has zero rows at this point in the build — a pure
-- rename, no data migration needed.

ALTER TABLE "local_seo_locations" RENAME COLUMN "businessName" TO "business_name";
ALTER TABLE "local_seo_locations" RENAME COLUMN "addressLine1" TO "address_line1";
ALTER TABLE "local_seo_locations" RENAME COLUMN "addressLine2" TO "address_line2";
ALTER TABLE "local_seo_locations" RENAME COLUMN "postalCode" TO "postal_code";
ALTER TABLE "local_seo_locations" RENAME COLUMN "websiteUrl" TO "website_url";

-- The non-blank CHECK constraint referenced the old quoted column name in
-- its expression; Postgres does not update constraint expressions on
-- rename in a way that changes the constraint name, but the expression
-- itself IS automatically rewritten to track the renamed column. Verify
-- intent by dropping and recreating with the same name, for clarity and
-- to guarantee the expression text matches the new column name exactly.
ALTER TABLE "local_seo_locations" DROP CONSTRAINT "local_seo_locations_business_name_non_blank_check";
ALTER TABLE "local_seo_locations" ADD CONSTRAINT "local_seo_locations_business_name_non_blank_check"
  CHECK (NULLIF(BTRIM("business_name"), '') IS NOT NULL);
