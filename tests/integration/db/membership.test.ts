import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { ConflictError, DatabaseError } from "@/lib/errors/app-error";

describe.skipIf(!isDatabaseConfigured)("Membership repository (database integration)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    // Deleting the organization cascades to its memberships — see the
    // cascade-behavior test below for an explicit assertion of that.
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    orgIds.length = 0;
    userIds.length = 0;
  });

  async function makeOrgAndUser() {
    const org = await organizationRepository.create({
      id: generateId(),
      name: "Membership Test Org",
      displayName: "Membership Test Org",
      slug: `membership-test-${generateId()}`,
    });
    const user = await userRepository.create({ id: generateId(), email: `member-${generateId()}@example.com`, name: "Member" });
    orgIds.push(org.id);
    userIds.push(user.id);
    return { org, user };
  }

  it("creates a membership linking an existing org and user", async () => {
    const { org, user } = await makeOrgAndUser();
    const membership = await membershipRepository.create({
      id: generateId(),
      organizationId: org.id,
      userId: user.id,
      role: "member",
    });

    expect(membership.organizationId).toBe(org.id);
    expect(membership.userId).toBe(user.id);
    expect(membership.status).toBe("ACTIVE");
    expect(membership.joinedAt).toBeInstanceOf(Date);
  });

  it("enforces one membership per (organization, user) pair", async () => {
    const { org, user } = await makeOrgAndUser();
    await membershipRepository.create({ id: generateId(), organizationId: org.id, userId: user.id, role: "member" });

    await expect(
      membershipRepository.create({ id: generateId(), organizationId: org.id, userId: user.id, role: "admin" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a membership referencing a nonexistent organization — foreign key behavior, translated to a safe AppError", async () => {
    const { user } = await makeOrgAndUser();
    await expect(
      membershipRepository.create({ id: generateId(), organizationId: generateId(), userId: user.id, role: "member" }),
    ).rejects.toBeInstanceOf(DatabaseError);
  });

  it("deleting an organization cascades to its memberships", async () => {
    const { org, user } = await makeOrgAndUser();
    const membership = await membershipRepository.create({
      id: generateId(),
      organizationId: org.id,
      userId: user.id,
      role: "owner",
    });

    await db.organization.delete({ where: { id: org.id } });
    orgIds.splice(orgIds.indexOf(org.id), 1); // already gone, don't try to delete it again in afterEach

    const found = await db.organizationMembership.findUnique({ where: { id: membership.id } });
    expect(found).toBeNull();
  });

  it("listForUser returns every organization a user belongs to, with the organization included", async () => {
    const { org, user } = await makeOrgAndUser();
    await membershipRepository.create({ id: generateId(), organizationId: org.id, userId: user.id, role: "member" });

    const memberships = await membershipRepository.listForUser(user.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].organization.id).toBe(org.id);
  });
});
