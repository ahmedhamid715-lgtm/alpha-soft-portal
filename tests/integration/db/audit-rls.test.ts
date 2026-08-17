import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
// Direct import, not the `@/lib/tenancy` barrel — see rls.test.ts's own
// comment for why (the barrel pulls in `next/headers`, which needs a
// real Next.js request context to resolve at all).
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 08 — direct database-level RLS tests for `AuditEvent` (spec
 * Phase 38: "the same genuinely-restricted-role methodology as Module
 * 06, never a superuser"). Every test here goes through
 * `withTenantContext()`, the same chokepoint the audit service itself
 * uses — no mocking, real Postgres, real `alpha_os_app` role.
 *
 * Skipped entirely (not failed) if `APP_DATABASE_URL` isn't configured —
 * same "explicit skip, never fake a pass" principle as `rls.test.ts`.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("AuditEvent Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  const eventIds: string[] = [];
  let orgAId: string;
  let orgBId: string;

  async function seedOrgs() {
    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Audit RLS Org A", displayName: "Audit RLS Org A", slug: `audit-rls-org-a-${orgAId}` });
    orgIds.push(orgAId);

    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Audit RLS Org B", displayName: "Audit RLS Org B", slug: `audit-rls-org-b-${orgBId}` });
    orgIds.push(orgBId);
  }
  const seeded = seedOrgs();

  afterAll(async () => {
    await seeded;
    if (eventIds.length) await db.auditEvent.deleteMany({ where: { id: { in: eventIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  function auditRow(organizationId: string | null, overrides: Partial<Prisma.AuditEventUncheckedCreateInput> = {}): Prisma.AuditEventUncheckedCreateInput {
    const id = generateId();
    return {
      id,
      organizationId,
      actorType: "SYSTEM" as const,
      action: "organization.created",
      category: "ORGANIZATION" as const,
      outcome: "SUCCESS" as const,
      requestId: id,
      correlationId: id,
      ...overrides,
    };
  }

  it("context A can insert its own organization's audit row; SELECT under context A sees it, context B does not", async () => {
    await seeded;
    const data = auditRow(orgAId);
    eventIds.push(data.id);

    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data }));

    const seenByA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.auditEvent.findUnique({ where: { id: data.id } }),
    );
    expect(seenByA?.id).toBe(data.id);

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
      tx.auditEvent.findUnique({ where: { id: data.id } }),
    );
    expect(seenByB).toBeNull();
  });

  it("context A cannot insert an audit row claiming organizationId = Org B (WITH CHECK rejects)", async () => {
    await seeded;
    const data = auditRow(orgBId);
    await expect(
      withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data })),
    ).rejects.toBeDefined();
  });

  it("a NULL-organization audit row (pre-tenant — e.g. a login failure) can be inserted under NO tenant context at all", async () => {
    await seeded;
    const data = auditRow(null);
    eventIds.push(data.id);

    // This is the exact scenario the INSERT policy's explicit
    // `OR organization_id IS NULL` clause exists for — without it, `NULL
    // = NULL` evaluates to SQL NULL (not TRUE) in the `WITH CHECK`
    // clause, silently rejecting every pre-tenant audit write. See
    // audit-system.md's own documented reasoning for this exact case.
    await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data }));

    const row = await db.auditEvent.findUnique({ where: { id: data.id } });
    expect(row).not.toBeNull();
    expect(row?.organizationId).toBeNull();
  });

  it("UPDATE on audit_events is unconditionally rejected — REVOKEd at the GRANT layer, not merely policy-filtered to zero rows", async () => {
    await seeded;
    const data = auditRow(orgAId, { resourceName: "before" });
    eventIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data }));

    // This is a stronger guarantee than "the RLS policy filters the
    // target row to nothing" (which would surface as `count: 0`) — the
    // restricted role has no UPDATE grant on this table at all
    // (`REVOKE UPDATE, DELETE ... FROM alpha_os_app` — see
    // `20260818090000_audit_system`'s migration), so Postgres rejects
    // the statement outright with `permission denied for table
    // audit_events`, even for a row the caller's own tenant context
    // legitimately owns.
    await expect(
      withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.auditEvent.updateMany({ where: { id: data.id }, data: { resourceName: "tampered" } }),
      ),
    ).rejects.toBeDefined();

    const real = await db.auditEvent.findUnique({ where: { id: data.id } });
    expect(real?.resourceName).toBe("before");
  });

  it("DELETE on audit_events is unconditionally rejected — REVOKEd at the GRANT layer, not merely policy-filtered to zero rows", async () => {
    await seeded;
    const data = auditRow(orgAId);
    eventIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data }));

    await expect(
      withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.auditEvent.deleteMany({ where: { id: data.id } }),
      ),
    ).rejects.toBeDefined();

    const real = await db.auditEvent.findUnique({ where: { id: data.id } });
    expect(real).not.toBeNull();
  });

  it("even a query with NO organizationId filter at all only returns the current context's own rows (simulates a forgotten WHERE clause)", async () => {
    await seeded;
    const dataA = auditRow(orgAId);
    const dataB = auditRow(orgBId);
    eventIds.push(dataA.id, dataB.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data: dataA }));
    await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data: dataB }));

    const rows = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.auditEvent.findMany({ where: { id: { in: [dataA.id, dataB.id] } } }),
    );
    expect(rows.map((r) => r.id)).toEqual([dataA.id]);
  });

  it("RLS's platform-context bypass is real and broad at the database layer — this is exactly why the APPLICATION layer (listPlatformAuditEvents) does its own narrower scoping on top, not instead of, RLS", async () => {
    await seeded;
    const dataA = auditRow(orgAId);
    const dataB = auditRow(orgBId);
    eventIds.push(dataA.id, dataB.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data: dataA }));
    await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.auditEvent.create({ data: dataB }));

    // Raw RLS, platform context: sees BOTH organizations' rows — the
    // database's own `tenant_is_platform_context()` OR-branch doesn't
    // discriminate by organization at all. This is deliberate (Module 06
    // precedent) — see `lib/audit/query.ts`'s `listPlatformAuditEvents()`
    // for the application-layer restriction that turns this broad
    // capability into "platform-wide events only, never an arbitrary
    // customer organization's own trail."
    const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
      tx.auditEvent.findMany({ where: { id: { in: [dataA.id, dataB.id] } } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([dataA.id, dataB.id].sort());
  });
});
