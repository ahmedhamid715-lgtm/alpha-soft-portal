import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { hashPassword } from "@/lib/auth/password";
import { verifyCredentials, createUserSession } from "@/server/services/auth-service";
import { userRepository } from "@/server/repositories/user-repository";
import { credentialRepository } from "@/server/repositories/credential-repository";
import { sessionRepository } from "@/server/repositories/session-repository";

/**
 * Real database integration tests for the authentication core (spec
 * sections 29 & 32). Covers every failure mode `verifyCredentials` must
 * return `null` for — indistinguishably, from the caller's perspective —
 * plus the session-creation side effect of a successful sign-in.
 */
describe.skipIf(!isDatabaseConfigured)("Auth service (database integration)", () => {
  const userIds: string[] = [];

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  async function makeActiveUserWithPassword(password: string) {
    const id = generateId();
    const user = await userRepository.create({ id, email: `auth-test-${id}@example.com`, name: "Auth Test" });
    await db.user.update({ where: { id }, data: { status: "ACTIVE" } });
    await credentialRepository.create({ id: generateId(), userId: id, passwordHash: await hashPassword(password) });
    userIds.push(id);
    return user;
  }

  it("returns the identity for correct credentials on an active account", async () => {
    const user = await makeActiveUserWithPassword("correct-horse-battery-staple");
    const result = await verifyCredentials({ email: user.email, password: "correct-horse-battery-staple" });
    expect(result).toEqual({ id: user.id, email: user.email, name: user.name });
  });

  it("returns null for a wrong password", async () => {
    const user = await makeActiveUserWithPassword("correct-horse-battery-staple");
    const result = await verifyCredentials({ email: user.email, password: "wrong-password-entirely" });
    expect(result).toBeNull();
  });

  it("returns null for a nonexistent account — indistinguishable from a wrong password", async () => {
    const result = await verifyCredentials({ email: "definitely-not-a-real-account@example.com", password: "whatever" });
    expect(result).toBeNull();
  });

  it("returns null for a suspended account, even with the correct password", async () => {
    const id = generateId();
    const user = await userRepository.create({ id, email: `suspended-${id}@example.com`, name: "Suspended" });
    await db.user.update({ where: { id }, data: { status: "SUSPENDED" } });
    await credentialRepository.create({ id: generateId(), userId: id, passwordHash: await hashPassword("correct-password-here") });
    userIds.push(id);

    const result = await verifyCredentials({ email: user.email, password: "correct-password-here" });
    expect(result).toBeNull();
  });

  it("returns null for an INVITED account (never signed in / no credential set yet)", async () => {
    const id = generateId();
    const user = await userRepository.create({ id, email: `invited-${id}@example.com`, name: "Invited" });
    userIds.push(id);
    // Still INVITED (default status) — no credential row exists either.
    const result = await verifyCredentials({ email: user.email, password: "anything" });
    expect(result).toBeNull();
  });

  it("returns null for malformed input rather than throwing", async () => {
    const result = await verifyCredentials({ email: "not-an-email", password: "" });
    expect(result).toBeNull();
  });

  it("createUserSession creates a real session row and updates lastLoginAt", async () => {
    const user = await makeActiveUserWithPassword("correct-horse-battery-staple");
    expect(user).toMatchObject({ email: user.email });

    const sessionId = await createUserSession(user.id, "test-agent/1.0");
    const session = await sessionRepository.findById(sessionId);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(user.id);
    expect(session?.userAgent).toBe("test-agent/1.0");
    expect(session?.revokedAt).toBeNull();
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const updated = await userRepository.findById(user.id);
    expect(updated?.lastLoginAt).toBeInstanceOf(Date);
  });
});
