-- Codex Performance Engineer finding PERF-GHL-01 (Build 34 — GHL
-- Automation OS review). `ghlAssetRepository.listForWorkspace()`
-- supports optional `implementationStatus`-only filtering and combined
-- `assetType` + `implementationStatus` filtering, both always ordered
-- by (sort_order ASC, created_at ASC). The initial migration shipped
-- `(workspace_id, sort_order, created_at)` for the unfiltered list and
-- `(workspace_id, asset_type, sort_order, created_at)` for the
-- type-filtered list, but had no single index covering the
-- status-only or type+status filter shapes together with their sort
-- columns — the exact filtered+ordered-index class this build's own
-- architecture freeze intended to ship complete from the start,
-- mirroring Website Development OS's own PERF-02 precedent (prisma/
-- migrations/20260915090000_website_pages_ordering_indexes) and
-- E-Commerce Development's own PERF-ECOM-02/04 precedent (prisma/
-- migrations/20260916210000_ecommerce_catalog_ordering_indexes).
-- Purely additive — does not touch any existing index/constraint/
-- table/trigger/policy.

-- Both requested names exceed PostgreSQL's 63-byte identifier limit
-- (NAMEDATALEN) and would otherwise be silently truncated at CREATE
-- time — named explicitly here at their real, final truncated form
-- (same discipline the initial migration already established for
-- `ghl_assets_workspace_id_required_for_launch_implementation_stat`),
-- and the Prisma schema's own `@@index(..., map: ...)` is pinned to
-- these exact same strings.
CREATE INDEX "ghl_assets_workspace_id_implementation_status_sort_order_create" ON "ghl_assets"("workspace_id", "implementation_status", "sort_order", "created_at");
CREATE INDEX "ghl_assets_workspace_id_asset_type_implementation_status_sort_o" ON "ghl_assets"("workspace_id", "asset_type", "implementation_status", "sort_order", "created_at");
