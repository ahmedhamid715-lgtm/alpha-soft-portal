-- Build 20 / Sales Pipeline — additional query indexes, found by Codex's
-- own Phase 8 (read-only) performance review and independently confirmed
-- by re-reading the exact repository queries in crm-deal-repository.ts
-- before applying. None of these change behavior — only query plans.

-- `crmDealRepository.listOpenForPipeline()` (the pipeline board's own
-- highest-traffic read: `WHERE organization_id = ? AND pipeline_id = ?
-- AND status = 'OPEN' ORDER BY created_at ASC LIMIT 500`). Neither
-- pre-existing index (`organization_id, status, created_at` or
-- `organization_id, pipeline_id, stage_id`) fully supports this specific
-- predicate + order; this one does, and also narrows the pipeline-scoped
-- OPEN forecast aggregations in crm-deal-forecast-service.ts before they
-- aggregate.
CREATE INDEX crm_deals_organization_id_pipeline_id_status_created_at_idx
  ON crm_deals (organization_id, pipeline_id, status, created_at);

-- `crmDealRepository.listDeals()`'s own unfiltered default path (no
-- status/pipeline filter — `WHERE organization_id = ? ORDER BY created_at
-- DESC`). Mirrors the tenant-plus-created-time index Build 19 already
-- gives crm_leads; crm_deals only had the status-qualified version, which
-- cannot satisfy a global created_at order without an extra sort once an
-- organization's deals span every status.
CREATE INDEX crm_deals_organization_id_created_at_idx
  ON crm_deals (organization_id, created_at);

-- `crmDealRepository.wonValueByCurrency()` (`WHERE organization_id = ? AND
-- status = 'WON' AND won_at >= ? AND won_at < ?`, grouped by currency —
-- the forecast summary's "won this period" card). Prisma cannot express a
-- partial index via `@@index` (same limitation already noted for
-- crm_pipelines_one_default_per_org above), so this stays hand-written
-- and unmirrored in schema.prisma. Partial on `status = 'WON'` because
-- `won_at` is only ever set for WON deals — indexing the other ~2/3 of
-- rows (OPEN/LOST, where won_at is always NULL) would be pure overhead.
CREATE INDEX crm_deals_organization_id_won_at_idx
  ON crm_deals (organization_id, won_at)
  WHERE status = 'WON' AND won_at IS NOT NULL;
