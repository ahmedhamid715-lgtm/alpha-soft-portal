import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { createOrganizationWithOwner } from "@/server/services/organization-service";
import { ConflictError, DatabaseError } from "@/lib/errors/app-error";

// Module 07 added authorization-gated functions to organization-service.ts
// (createOrganization, updateOrganizationProfile, ...) alongside the
// pre-existing createOrganizationWithOwner this file actually tests —
// since it's all one module, importing anything from it now transitively
// pulls in `@/lib/auth/session-guard` → `@/auth` (Auth.js), which needs
// Next's own module resolution for `next/server` and fails to even load
// under plain Vitest. None of the tests below call anything that needs
// real authentication, but the module-load chain doesn't know that —
// mocked the same way `role-service.test.ts`/`authorization-engine.test.ts`
// (Modules 05/06) already do, purely so this file loads at all.
vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => null),
  getCurrentMembership: vi.fn(async () => null),
}));

describe.skipIf(!isDatabaseConfigured)("Transactions (database integration)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    orgIds.length = 0;
    userIds.length = 0;
  });

  it("withTransaction rolls back every write when a later write in the same transaction fails", async () => {
    const orgId = generateId();
    const slug = `rollback-test-${orgId}`;

    await expect(
      withTransaction(async (tx) => {
        await organizationRepository.create({ id: orgId, name: "Rollback Test", displayName: "Rollback Test", slug }, tx);
        // A membership referencing a user that doesn't exist violates the
        // foreign key — this must fail and take the organization created
        // just above down with it, not leave a half-created org behind.
        await membershipRepository.create(
          { id: generateId(), organizationId: orgId, userId: generateId(), role: "member" },
          tx,
        );
      }),
    ).rejects.toBeInstanceOf(DatabaseError);

    // Not pushed to orgIds for cleanup — if the rollback worked, there's
    // nothing to clean up. If this find succeeds, the rollback failed.
    const found = await organizationRepository.findById(orgId);
    expect(found).toBeNull();
  });

  it("createOrganizationWithOwner creates the organization and its owner membership atomically", async () => {
    const suffix = generateId();
    const result = await createOrganizationWithOwner({
      organization: { name: "Atomic Co", displayName: "Atomic Co", slug: `atomic-co-${suffix}` },
      owner: { email: `owner-${suffix}@example.com`, name: "Atomic Owner" },
    });
    orgIds.push(result.organization.id);
    userIds.push(result.membership.userId);

    expect(result.membership.organizationId).toBe(result.organization.id);
    expect(result.membership.role).toBe("owner");
    expect(result.membership.status).toBe("ACTIVE");

    const membership = await membershipRepository.findByOrganizationAndUser(result.organization.id, result.membership.userId);
    expect(membership).not.toBeNull();
  });

  it("createOrganizationWithOwner reuses an existing user by email instead of creating a duplicate", async () => {
    const suffix = generateId();
    const existingUser = await userRepository.create({ id: generateId(), email: `existing-${suffix}@example.com`, name: "Existing" });
    userIds.push(existingUser.id);

    const result = await createOrganizationWithOwner({
      organization: { name: "Second Org", displayName: "Second Org", slug: `second-org-${suffix}` },
      owner: { email: `existing-${suffix}@example.com`, name: "Existing" },
    });
    orgIds.push(result.organization.id);

    expect(result.membership.userId).toBe(existingUser.id);
    const userCount = await db.user.count({ where: { email: `existing-${suffix}@example.com` } });
    expect(userCount).toBe(1);
  });

  it("createOrganizationWithOwner rejects a duplicate slug via a safe ConflictError, without touching the database", async () => {
    const suffix = generateId();
    const first = await createOrganizationWithOwner({
      organization: { name: "Dup Slug", displayName: "Dup Slug", slug: `dup-slug-${suffix}` },
      owner: { email: `dup-owner-${suffix}@example.com`, name: "Dup Owner" },
    });
    orgIds.push(first.organization.id);
    userIds.push(first.membership.userId);

    await expect(
      createOrganizationWithOwner({
        organization: { name: "Dup Slug Again", displayName: "Dup Slug Again", slug: `dup-slug-${suffix}` },
        owner: { email: `dup-owner-2-${suffix}@example.com`, name: "Dup Owner 2" },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // The second attempt's owner user must not have been created despite
    // failing on the slug check — no partial state from a rejected call.
    const secondOwner = await userRepository.findByEmail(`dup-owner-2-${suffix}@example.com`);
    expect(secondOwner).toBeNull();
  });
});
