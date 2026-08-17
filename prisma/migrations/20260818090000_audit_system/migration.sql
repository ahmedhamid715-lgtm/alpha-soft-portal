-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM', 'SERVICE', 'AI', 'API', 'AUTOMATION');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "audit_category" AS ENUM ('AUTHENTICATION', 'AUTHORIZATION', 'ORGANIZATION', 'MEMBERSHIP', 'INVITATION', 'ROLE', 'SECURITY', 'DATA', 'SYSTEM', 'ADMINISTRATION', 'COMPLIANCE');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_service_id" TEXT,
    "actor_display_name" TEXT,
    "action" TEXT NOT NULL,
    "category" "audit_category" NOT NULL,
    "outcome" "audit_outcome" NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "resource_name" TEXT,
    "previous_state" JSONB,
    "new_state" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" VARCHAR(255),
    "request_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_resource_type_resource_id_idx" ON "audit_events"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_request_id_idx" ON "audit_events"("request_id");

-- CreateIndex
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

-- CreateIndex
CREATE INDEX "audit_events_category_created_at_idx" ON "audit_events"("category", "created_at");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Row-level security (Module 08) — see docs/architecture/audit-system.md
-- "Tenant isolation" and docs/architecture/rls.md for the shared
-- tenant_current_organization_id()/tenant_is_platform_context() context
-- functions this reuses unchanged (defined in migration
-- 20260817090000_row_level_security).
--
-- SELECT/INSERT policies only — deliberately no UPDATE/DELETE policy at
-- all. With FORCE ROW LEVEL SECURITY set, a command with zero matching
-- policies matches zero rows unconditionally, regardless of what
-- privilege the connecting role holds. This is the append-only
-- guarantee expressed directly in the RLS layer, not just left to the
-- GRANT/REVOKE below — belt and suspenders, not a substitute for it.
-- =============================================================================

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON audit_events
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- INSERT additionally allows organization_id IS NULL unconditionally —
-- audit writes for pre-tenant events (a login failure for an email that
-- doesn't even resolve to a real user, an authorization denial before
-- any org context exists) happen with NO tenant context established at
-- all (app.organization_id/app.is_platform both unset), so
-- tenant_current_organization_id() and tenant_is_platform_context()
-- alone would reject a legitimate organization_id = NULL row (SQL NULL
-- = NULL is NULL, not TRUE, in a WITH CHECK clause). Safe to allow
-- unconditionally: organization_id is never client-supplied — it is
-- always the audit service's own server-resolved value (see
-- lib/audit/service.ts), never taken from request input.
CREATE POLICY tenant_isolation_insert ON audit_events
  FOR INSERT
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    OR organization_id IS NULL
    OR tenant_is_platform_context()
  );

-- =============================================================================
-- Restricted-role privilege restriction (Module 08 spec Phase 8/37/38) —
-- audit_events is INSERT + SELECT only for the application's own
-- restricted role, enforced at the database-privilege layer, not just
-- by the application never calling update()/delete() (which it also
-- doesn't — see server/repositories/audit-event-repository.ts). This is
-- the honest, independently-testable half of "immutable from the
-- application's perspective" — see docs/architecture/audit-security.md
-- for exactly what this does and does not defend against (a database
-- superuser is unaffected by any REVOKE — see rls.md "The restricted
-- role").
--
-- Guarded by existence check: alpha_os_app is created once per
-- environment, OUTSIDE migrations (rls.md — it's credential-bearing),
-- so a fresh environment that hasn't run that setup yet must not fail
-- this migration. Whoever creates the role afterward must re-run this
-- REVOKE as part of that setup — documented in rls.md alongside the
-- role's own creation SQL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alpha_os_app') THEN
    REVOKE UPDATE, DELETE ON audit_events FROM alpha_os_app;
  END IF;
END $$;
