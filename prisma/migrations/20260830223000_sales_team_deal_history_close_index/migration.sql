-- Build 21 (Sales Team Management) — a close-event-specific index for
-- `crm_deal_history`, found by Codex's own Phase 8 (read-only)
-- performance review. Purely additive; Build 20's own historical
-- `crm_deal_history_organization_id_deal_id_occurred_at_idx` index and
-- migration are untouched and remain the right index for the deal-
-- timeline queries it was built for.
--
-- `crmSalesPerformanceRepository.closedDealsByActor()` — the highest-
-- traffic Sales Team aggregate (called by every performance summary,
-- twice, and again for every REVENUE_WON/DEALS_WON goal attainment) —
-- filters `organization_id = ? AND type = ? AND occurred_at >= ? AND
-- occurred_at < ?`. The existing index's second key (`deal_id`) is
-- unconstrained by this query, so Postgres cannot use its own third key
-- (`occurred_at`) to narrow the range efficiently; it must walk more of
-- the organization's own deal history before filtering.
--
-- Partial + covering: WON/LOST events are the only ones this query ever
-- asks for (routine STAGE_CHANGED/VALUE_CHANGED/NOTE entries are never
-- part of a closed-deal aggregate), and INCLUDE-ing actor_user_id/
-- deal_id lets Postgres answer entirely from the index for this query
-- shape without a heap lookup.
CREATE INDEX crm_deal_history_org_type_occurred_close_idx
  ON crm_deal_history (organization_id, type, occurred_at)
  INCLUDE (actor_user_id, deal_id)
  WHERE type IN ('WON', 'LOST');
