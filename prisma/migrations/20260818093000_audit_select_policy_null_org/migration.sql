-- Fix: `tenant_isolation_select` on `audit_events` was missing the same
-- `organization_id IS NULL` allowance `tenant_isolation_insert` already
-- has. Without it, a pre-tenant audit row (organization_id = NULL —
-- e.g. a login failure before any org context exists) could be INSERTed
-- but never read back: Prisma's `create()` always issues
-- `INSERT ... RETURNING *`, and `FORCE ROW LEVEL SECURITY` requires the
-- SELECT policy to pass for a RETURNING clause too, not just the INSERT
-- policy for the write itself. A non-platform context inserting/reading
-- its own just-written null-org row failed with "new row violates
-- row-level security policy" even though the INSERT itself was
-- perfectly legitimate per the INSERT policy's own `OR organization_id
-- IS NULL` clause.
--
-- Found by running the actual Module 08 test suite against real
-- Postgres (Phase 40/41 — not by inspection: the migration as originally
-- written "looked" correct, and every path that currently exercises it
-- in the live application happens to use the superuser `db` client for
-- best-effort audit writes, which bypasses RLS entirely and masked the
-- gap). See `docs/architecture/audit-system.md`'s "Bugs found by
-- actually running the suite" section and
-- `tests/integration/db/audit-rls.test.ts`'s regression test for this
-- exact case.
--
-- Safe to widen: a NULL-organization row is not tenant-owned data in the
-- first place (it doesn't belong to any specific organization), so
-- letting any authenticated tenant context see it at the RLS layer does
-- not reopen cross-tenant leakage — Org A's context still cannot see Org
-- B's rows, the actual property RLS exists to guarantee. The
-- APPLICATION layer's own explicit `organizationId` filters
-- (`lib/audit/query.ts`) are what narrow "visible under RLS" down to
-- "actually returned to this caller" — see audit-system.md "Platform vs.
-- organization audit" for why neither layer substitutes for the other.
DROP POLICY IF EXISTS tenant_isolation_select ON audit_events;

CREATE POLICY tenant_isolation_select ON audit_events
  FOR SELECT
  USING (
    organization_id = tenant_current_organization_id()
    OR organization_id IS NULL
    OR tenant_is_platform_context()
  );
