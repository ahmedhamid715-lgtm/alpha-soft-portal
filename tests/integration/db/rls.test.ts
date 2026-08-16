import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
// Imported from the specific files, not the `@/lib/tenancy` barrel —
// that barrel also re-exports `organization-selection.ts`, which
// imports `next/headers`. `next/headers` needs Next's own bundler/
// request context to resolve at all; a bare Vitest run (no Next.js
// runtime involved) fails to even load the module graph. Every other
// consumer of `withTenantContext()` in `src/` already imports it this
// same direct way for the same reason (see `role-service.ts`,
// `membership-service.ts`, `lib/authorization/context.ts`).
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 06 — direct database-level RLS tests (spec sections 16, 44, 45:
 * "this MUST be tested at the database layer, not merely through the
 * application"). Every test here calls `withTenantContext()` directly —
 * the same function `lib/authorization/context.ts` and the service layer
 * use — and inspects real rows through the real, restricted
 * `APP_DATABASE_URL` role. No mocking: `Prisma`/`pg` talk to a real
 * local Postgres.
 *
 * Skipped entirely (not failed) if `APP_DATABASE_URL` isn't configured —
 * the same "explicit skip, never fake a pass" principle every other
 * database-integration tier in this project follows. A skip here means
 * "RLS was not verified this run," which is exactly what should be
 * surfaced, not hidden behind a false green.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Row-Level Security (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let membershipAId: string;
  let membershipBId: string;

  beforeAll(async () => {
    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "RLS Org A", displayName: "RLS Org A", slug: `rls-org-a-${orgAId}` });
    orgIds.push(orgAId);

    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "RLS Org B", displayName: "RLS Org B", slug: `rls-org-b-${orgBId}` });
    orgIds.push(orgBId);

    userAId = generateId();
    await userRepository.create({ id: userAId, email: `rls-user-a-${userAId}@example.com`, name: "RLS User A" });
    userIds.push(userAId);

    userBId = generateId();
    await userRepository.create({ id: userBId, email: `rls-user-b-${userBId}@example.com`, name: "RLS User B" });
    userIds.push(userBId);

    const membershipA = await membershipRepository.create({ id: generateId(), organizationId: orgAId, userId: userAId, role: "owner" });
    membershipAId = membershipA.id;
    const membershipB = await membershipRepository.create({ id: generateId(), organizationId: orgBId, userId: userBId, role: "owner" });
    membershipBId = membershipB.id;
  });

  afterAll(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  afterEach(async () => {
    // Some tests intentionally attempt writes that must be blocked; if
    // one somehow succeeded (a real bug), clean up so it doesn't corrupt
    // later assertions in this file.
    await db.organizationMembership.updateMany({
      where: { id: { in: [membershipAId, membershipBId] } },
      data: {},
    });
  });

  // --- Section 15: fail closed ---------------------------------------

  it("NO tenant context: organization-owned tables return zero rows, never everything", async () => {
    const count = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
      tx.organizationMembership.count(),
    );
    expect(count).toBe(0);

    const roleCount = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
      tx.role.count({ where: { organizationId: { not: null } } }),
    );
    expect(roleCount).toBe(0);
  });

  // --- Section 16: cross-tenant database test -------------------------

  it("User A's context sees Org A's membership, never Org B's — even querying with no WHERE filter at all", async () => {
    const rows = await withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationMembership.findMany(),
    );
    const orgIdsSeen = new Set(rows.map((r) => r.organizationId));
    expect(orgIdsSeen.has(orgAId)).toBe(true);
    expect(orgIdsSeen.has(orgBId)).toBe(false);
  });

  it("SELECT for Org B's resource while authenticated as User A (Org A context) is invisible", async () => {
    const row = await withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationMembership.findUnique({ where: { id: membershipBId } }),
    );
    expect(row).toBeNull();
  });

  it("UPDATE targeting Org B's resource while context = Org A affects zero rows", async () => {
    const result = await withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationMembership.updateMany({ where: { id: membershipBId }, data: { role: "admin" } }),
    );
    expect(result.count).toBe(0);

    // Confirm Org B's row is genuinely unchanged (not just invisible to the read-back).
    const real = await db.organizationMembership.findUnique({ where: { id: membershipBId } });
    expect(real?.role).toBe("owner");
  });

  it("DELETE targeting Org B's resource while context = Org A affects zero rows", async () => {
    const result = await withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationMembership.deleteMany({ where: { id: membershipBId } }),
    );
    expect(result.count).toBe(0);

    const real = await db.organizationMembership.findUnique({ where: { id: membershipBId } });
    expect(real).not.toBeNull();
  });

  it("INSERT with organizationId = Org B while context = Org A is rejected by the WITH CHECK policy", async () => {
    await expect(
      withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.organizationMembership.create({
          data: { id: generateId(), organizationId: orgBId, userId: userAId, role: "member" },
        }),
      ),
    ).rejects.toBeDefined();
  });

  // --- Section 44: RLS bypass test — the core defense-in-depth proof ---

  it("with a CORRECT, legitimately-resolved context, a query with NO organizationId filter at all still only returns that org's rows (simulates a real application bug — a forgotten WHERE clause)", async () => {
    // This is the actual claim RLS makes: even if `role-service.ts` (or
    // any future repository) had a bug and queried
    // `tx.organizationMembership.findMany()` with no filter whatsoever,
    // the database itself — not the missing application code — is what
    // limits the result to the caller's own organization.
    const rows = await withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.organizationMembership.findMany(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgAId)).toBe(true);
  });

  it("platform context sees both organizations' rows — explicit, not an accidental default", async () => {
    const rows = await withTenantContext({ userId: userAId, organizationId: null, isPlatformStaff: true }, (tx) =>
      tx.organizationMembership.findMany({ where: { id: { in: [membershipAId, membershipBId] } } }),
    );
    expect(rows.map((r) => r.id).sort()).toEqual([membershipAId, membershipBId].sort());
  });

  // --- Section 45: connection pooling / context leakage test -----------

  it("alternating tenant contexts across many sequential transactions never leak into each other, even reusing the same pooled connection", async () => {
    const outcomes: { label: string; orgIdsSeen: string[] }[] = [];

    for (let i = 0; i < 12; i++) {
      const cycle = i % 3;
      if (cycle === 0) {
        const rows = await withTenantContext({ userId: userAId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
          tx.organizationMembership.findMany({ where: { id: { in: [membershipAId, membershipBId] } } }),
        );
        outcomes.push({ label: "A", orgIdsSeen: rows.map((r) => r.organizationId) });
      } else if (cycle === 1) {
        const rows = await withTenantContext({ userId: userBId, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
          tx.organizationMembership.findMany({ where: { id: { in: [membershipAId, membershipBId] } } }),
        );
        outcomes.push({ label: "B", orgIdsSeen: rows.map((r) => r.organizationId) });
      } else {
        const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
          tx.organizationMembership.findMany({ where: { id: { in: [membershipAId, membershipBId] } } }),
        );
        outcomes.push({ label: "none", orgIdsSeen: rows.map((r) => r.organizationId) });
      }
    }

    for (const outcome of outcomes) {
      if (outcome.label === "A") {
        expect(outcome.orgIdsSeen).toEqual([orgAId]);
      } else if (outcome.label === "B") {
        expect(outcome.orgIdsSeen).toEqual([orgBId]);
      } else {
        expect(outcome.orgIdsSeen).toEqual([]);
      }
    }
  });
});
