-- Module 06 — Row-Level Security (defense-in-depth beneath Module 05's
-- application authorization, see docs/architecture/rls.md for the full
-- design and why these three tables specifically).
--
-- This migration is schema-only — no role names, no passwords, nothing
-- environment-specific. The restricted, non-superuser role RLS actually
-- protects against is provisioned separately (scripts/setup-rls-role.sql,
-- run once per environment by a human) precisely because it's
-- credential-bearing and must never live in a committed migration file.

-- ============================================================================
-- Context functions
-- ============================================================================
-- Read transaction-local settings established by withTenantContext()
-- (src/lib/tenancy/context.ts) via `SELECT set_config('app.*', value, true)`
-- — the `true` (is_local) argument scopes every one of these to the
-- current transaction only, safe under PgBouncer/Supavisor transaction-mode
-- pooling (see rls.md "Transaction-local context"). NULLIF(..., '') turns
-- "never set" AND "explicitly set to empty string" into the same NULL —
-- fail-closed: a NULL organization_id can never equal a real row's
-- organization_id, so "no context" means "no rows," never "all rows."
--
-- No SECURITY DEFINER — these only read a GUC the calling transaction
-- itself set; there is no privilege to elevate, so the default SECURITY
-- INVOKER is correct and safer (see rls.md "Database functions").

CREATE OR REPLACE FUNCTION tenant_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION tenant_current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION tenant_is_platform_context()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_platform', true), '')::boolean, false);
$$;

-- ============================================================================
-- organization_memberships
-- ============================================================================
-- SELECT allows THREE cases, deliberately not just "matches current org":
-- `user_id = tenant_current_user_id()` lets a caller discover their OWN
-- memberships non-circularly (before any specific organization_id context
-- has been established — this is how "which orgs do I belong to,"
-- Module 05's org-selection flow, works at all under RLS). The other two
-- are the ordinary tenant-match and platform-staff cases.

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON organization_memberships
  FOR SELECT
  USING (
    user_id = tenant_current_user_id()
    OR organization_id = tenant_current_organization_id()
    OR tenant_is_platform_context()
  );

CREATE POLICY tenant_isolation_insert ON organization_memberships
  FOR INSERT
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    OR tenant_is_platform_context()
  );

CREATE POLICY tenant_isolation_update ON organization_memberships
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON organization_memberships
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- ============================================================================
-- roles
-- ============================================================================
-- System roles (organization_id IS NULL) are global reference data —
-- visible to everyone, exactly like the `Permission` catalog (which has
-- no RLS at all — see rls.md "Tables deliberately without RLS"). Custom
-- roles are visible/mutable only within their own organization or by
-- platform staff.

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON roles
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id = tenant_current_organization_id()
    OR tenant_is_platform_context()
  );

CREATE POLICY tenant_isolation_insert ON roles
  FOR INSERT
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    OR tenant_is_platform_context()
  );

CREATE POLICY tenant_isolation_update ON roles
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON roles
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- ============================================================================
-- role_permissions
-- ============================================================================
-- No direct organization_id column (a pure join table — see rbac.md
-- "Deletion safety") — scoped via EXISTS against `roles`, which is itself
-- RLS-protected by the policies above, so this correctly inherits the
-- same system/own-org/platform visibility rule without duplicating it.

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON role_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND (
          r.organization_id IS NULL
          OR r.organization_id = tenant_current_organization_id()
          OR tenant_is_platform_context()
        )
    )
  );

CREATE POLICY tenant_isolation_insert ON role_permissions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND (r.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_update ON role_permissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND (r.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND (r.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_delete ON role_permissions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_permissions.role_id
        AND (r.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );
