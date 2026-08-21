import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 12 — direct database-level RLS tests for
 * `organization_invitation_policies`, same methodology
 * `notification-rls.test.ts`/`audit-rls.test.ts` already established:
 * real Postgres, the genuinely restricted `alpha_os_app` role via
 * `withTenantContext()`, never a superuser, never mocked. Same plain
 * org/platform policy shape as `organization_onboarding` — see this
 * table's own migration comment
 * (20260821090000_invitation_policy_rls/migration.sql).
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("organization_invitation_policies Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  const policyIds: string[] = [];

  let orgAId: string;
  let orgBId: string;

  async function seed() {
    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Policy RLS Org A", displayName: "Policy RLS Org A", slug: `policy-rls-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "Policy RLS Org B", displayName: "Policy RLS Org B", slug: `policy-rls-org-b-${orgBId}` });
    orgIds.push(orgAId, orgBId);
  }
  const seeded = seed();

  // `organizationId` is `@unique` on this table (Module 12 — a 1:1
  // relationship) — every test below inserts a fresh row for the SAME
  // orgAId, so it must be cleaned up between tests, not just at the very
  // end, or the second test's own INSERT would fail on the unique
  // constraint before RLS ever gets a say.
  afterEach(async () => {
    if (policyIds.length) await db.organizationInvitationPolicy.deleteMany({ where: { id: { in: policyIds } } });
    policyIds.length = 0;
  });

  afterAll(async () => {
    await seeded;
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  function policyRow(organizationId: string) {
    const id = generateId();
    return { id, organizationId, requireOwnerForInvitations: false, allowedDomains: [] as string[], blockedDomains: [] as string[], invitationExpiryHours: 168 };
  }

  it("Org A can INSERT its own policy row under its own tenant context", async () => {
    await seeded;
    const data = policyRow(orgAId);
    policyIds.push(data.id);

    const created = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationInvitationPolicy.create({ data }),
    );
    expect(created.organizationId).toBe(orgAId);
  });

  it("Org B's tenant context cannot SELECT Org A's policy row — cross-tenant isolation", async () => {
    await seeded;
    const data = policyRow(orgAId);
    policyIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.create({ data }));

    const seenByOrgA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationInvitationPolicy.findUnique({ where: { id: data.id } }),
    );
    expect(seenByOrgA?.id).toBe(data.id);

    const seenByOrgB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
      tx.organizationInvitationPolicy.findUnique({ where: { id: data.id } }),
    );
    expect(seenByOrgB).toBeNull();
  });

  it("Org B's tenant context cannot UPDATE Org A's policy row (filtered to zero rows, not an error)", async () => {
    await seeded;
    const data = policyRow(orgAId);
    policyIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.create({ data }));

    const result = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
      tx.organizationInvitationPolicy.updateMany({ where: { id: data.id }, data: { requireOwnerForInvitations: true } }),
    );
    expect(result.count).toBe(0);

    const real = await db.organizationInvitationPolicy.findUnique({ where: { id: data.id } });
    expect(real?.requireOwnerForInvitations).toBe(false);
  });

  it("Org B's tenant context cannot forge an INSERT tagged with Org A's organizationId — WITH CHECK rejects the mismatch", async () => {
    await seeded;
    const forged = policyRow(orgAId); // organizationId = A, but the session context below is B
    policyIds.push(forged.id);

    await expect(
      withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.create({ data: forged })),
    ).rejects.toBeDefined();

    const real = await db.organizationInvitationPolicy.findUnique({ where: { id: forged.id } });
    expect(real).toBeNull();
  });

  it("platform context can SELECT any organization's policy row", async () => {
    await seeded;
    const data = policyRow(orgAId);
    policyIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.create({ data }));

    const seenByPlatform = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
      tx.organizationInvitationPolicy.findUnique({ where: { id: data.id } }),
    );
    expect(seenByPlatform?.id).toBe(data.id);
  });

  it("NO tenant context at all fails closed — zero rows visible, never every organization's policy", async () => {
    await seeded;
    const data = policyRow(orgAId);
    policyIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.create({ data }));

    const row = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
      tx.organizationInvitationPolicy.findUnique({ where: { id: data.id } }),
    );
    expect(row).toBeNull();

    const count = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.count());
    expect(count).toBe(0);
  });

  it("Org B's tenant context cannot DELETE Org A's policy row", async () => {
    await seeded;
    const data = policyRow(orgAId);
    policyIds.push(data.id);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.organizationInvitationPolicy.create({ data }));

    const result = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
      tx.organizationInvitationPolicy.deleteMany({ where: { id: data.id } }),
    );
    expect(result.count).toBe(0);

    const real = await db.organizationInvitationPolicy.findUnique({ where: { id: data.id } });
    expect(real).not.toBeNull();
  });
});
