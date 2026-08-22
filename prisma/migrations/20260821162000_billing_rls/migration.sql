-- Row-Level Security for Module 13's billing domain — see
-- docs/architecture/billing-data-model.md for the full ownership
-- classification this migration implements.
--
-- Two shapes, both established by prior migrations, neither new:
--
--   1. DIRECTLY organization-owned (billing_accounts, subscriptions,
--      invoices, payments, credit_ledger_entries) — the plain
--      `organization_id = tenant_current_organization_id() OR
--      tenant_is_platform_context()` policy every prior organization-
--      owned table already uses (organization_onboarding,
--      organization_invitation_policies, ...).
--
--   2. TRANSITIVELY organization-owned (subscription_items via
--      subscription_id, invoice_line_items via invoice_id, refunds via
--      payment_id) — an EXISTS-subquery policy joining to the parent,
--      the exact pattern `role_permissions` established
--      (20260817090000_row_level_security/migration.sql) for a child
--      table with no organization_id column of its own.
--
-- `billing_webhook_events` deliberately has NO RLS at all — see that
-- table's own doc comment in schema.prisma and
-- docs/architecture/billing-webhooks.md "Why this table has no RLS."
-- FORCE ROW LEVEL SECURITY throughout, same as every other RLS-protected
-- table in this codebase — the restricted `alpha_os_app` role gets no
-- special treatment beyond what these policies grant.

-- --- billing_accounts --------------------------------------------------

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON billing_accounts
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON billing_accounts
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON billing_accounts
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON billing_accounts
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- --- subscriptions -------------------------------------------------------

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON subscriptions
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON subscriptions
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON subscriptions
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON subscriptions
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- --- invoices --------------------------------------------------------------

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON invoices
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON invoices
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON invoices
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON invoices
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- --- payments ----------------------------------------------------------

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON payments
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON payments
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON payments
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON payments
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- --- credit_ledger_entries -----------------------------------------------

ALTER TABLE credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON credit_ledger_entries
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON credit_ledger_entries
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- No UPDATE/DELETE policy at all on credit_ledger_entries — deliberate,
-- not an oversight: this is an append-only ledger (spec §14/§37); with
-- no matching policy, RLS filters both operations to zero rows for
-- EVERY role, including platform staff, the same "unconditionally
-- rejected, not merely policy-filtered" precedent
-- `notification-rls.test.ts` already proved for `notifications` DELETE.
-- A correction is a new, offsetting ledger entry, never a mutation of
-- an existing one.

-- --- subscription_items (transitively organization-owned via subscription_id) ---

ALTER TABLE subscription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON subscription_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_items.subscription_id
        AND (s.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON subscription_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_items.subscription_id
        AND (s.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_update ON subscription_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_items.subscription_id
        AND (s.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_items.subscription_id
        AND (s.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_delete ON subscription_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_items.subscription_id
        AND (s.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- --- invoice_line_items (transitively organization-owned via invoice_id) ---

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON invoice_line_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (i.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON invoice_line_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND (i.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- No UPDATE policy — invoice lines are immutable (spec §11; see this
-- table's own doc comment in schema.prisma). No DELETE policy either
-- (spec §37: never destroy financial history) — both are unconditionally
-- filtered to zero rows for every role, the same append-only discipline
-- `credit_ledger_entries` above uses.

-- --- refunds (transitively organization-owned via payment_id) ------------

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON refunds
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = refunds.payment_id
        AND (p.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON refunds
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = refunds.payment_id
        AND (p.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_update ON refunds
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = refunds.payment_id
        AND (p.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = refunds.payment_id
        AND (p.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- No DELETE policy — a refund, once recorded, is never removed (spec §37).

-- --- plans / plan_prices ---------------------------------------------------
-- Deliberately NO RLS. The plan catalog is platform-wide reference data,
-- not organization-owned — every organization must be able to read the
-- SAME active catalog (there is no "tenant context" that would make
-- sense to filter it by), the same reasoning `organizations` itself has
-- no RLS (see organization-security.md "RLS — Organization itself vs.
-- everything that references it"). Write access is gated at the
-- application layer by `billing.plan.manage` (PLATFORM-scope), not by a
-- Postgres policy — there is no "wrong tenant" for a write to leak
-- across, only "authorized platform staff" vs. everyone else, which
-- `requirePermission()` already enforces before any query runs.

-- --- billing_webhook_events -------------------------------------------------
-- Deliberately NO RLS — see this table's own doc comment in
-- schema.prisma and docs/architecture/billing-webhooks.md "Why this
-- table has no RLS."
