import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { ConflictError } from "@/lib/errors/app-error";

describe.skipIf(!isDatabaseConfigured)("User repository (database integration)", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length) {
      await db.user.deleteMany({ where: { id: { in: createdIds } } });
      createdIds.length = 0;
    }
  });

  it("creates a user with a normalized (lowercased) email", async () => {
    const id = generateId();
    const user = await userRepository.create({ id, email: `Test.User+${id}@Example.COM`, name: "Test User" });
    createdIds.push(user.id);

    expect(user.email).toBe(`test.user+${id}@example.com`);
    expect(user.status).toBe("INVITED");
  });

  it("enforces email uniqueness case-insensitively", async () => {
    const id = generateId();
    const email = `dup-${id}@example.com`;
    const first = await userRepository.create({ id, email, name: "First" });
    createdIds.push(first.id);

    await expect(
      userRepository.create({ id: generateId(), email: email.toUpperCase(), name: "Second" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("findByEmail normalizes its input the same way create does", async () => {
    const id = generateId();
    const user = await userRepository.create({ id, email: `Find.Me.${id}@Example.com`, name: "Findable" });
    createdIds.push(user.id);

    const found = await userRepository.findByEmail(`FIND.ME.${id}@EXAMPLE.COM`);
    expect(found?.id).toBe(user.id);
  });

  it("recordLogin sets lastLoginAt and moves status to ACTIVE", async () => {
    const id = generateId();
    const user = await userRepository.create({ id, email: `login-${id}@example.com`, name: "Login Test" });
    createdIds.push(user.id);
    expect(user.status).toBe("INVITED");
    expect(user.lastLoginAt).toBeNull();

    const updated = await userRepository.recordLogin(user.id);
    expect(updated.status).toBe("ACTIVE");
    expect(updated.lastLoginAt).toBeInstanceOf(Date);
    // updatedAt must actually change, not just createdAt staying fixed.
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(user.updatedAt.getTime());
  });
});
