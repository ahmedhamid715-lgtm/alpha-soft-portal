-- Codex Performance Engineer finding PERF-02 (Build 32 — Website
-- Development OS review). `websitePageRepository.listForSite()` always
-- orders by (sort_order ASC, created_at ASC), optionally filtered by
-- `status`, and is meant to be the index-ordered top-N scan the
-- documented "10/100/1000+ pages per site" scale requires. The original
-- `website_pages_site_id_status_idx` (site_id, status) stops short of the
-- sort columns, forcing Postgres to sort the matched rows itself. Purely
-- additive — does not touch any existing index/constraint/table.

CREATE INDEX "website_pages_site_id_sort_order_created_at_idx" ON "website_pages"("site_id", "sort_order", "created_at");
CREATE INDEX "website_pages_site_id_status_sort_order_created_at_idx" ON "website_pages"("site_id", "status", "sort_order", "created_at");
