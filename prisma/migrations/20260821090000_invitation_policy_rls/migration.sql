-- Row-Level Security for `organization_invitation_policies` (Module 12).
-- A follow-up migration, not folded into 20260819104612_invitation_policy,
-- because that migration was already applied before this policy block was
-- written — see project convention "do not edit an already-applied
-- migration, create a new one" (the same discipline every prior module's
-- own RLS follow-up has used).
--
-- Exact tenant-isolation shape as `organization_onboarding`
-- (20260817100000_user_org_management/migration.sql) — a 1:1,
-- organization-owned table with no extra per-row user escape hatch:
-- `organization_id = tenant_current_organization_id() OR
-- tenant_is_platform_context()`. Enforced with FORCE ROW LEVEL SECURITY
-- so even the table owner (the migration role) is bound by it outside an
-- explicit BYPASSRLS session — the restricted `alpha_os_app` role never
-- gets special treatment beyond what these policies grant.

ALTER TABLE organization_invitation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitation_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON organization_invitation_policies
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON organization_invitation_policies
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON organization_invitation_policies
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON organization_invitation_policies
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());
