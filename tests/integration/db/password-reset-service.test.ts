import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requestPasswordReset, resetPassword } from "@/server/services/password-reset-service";
import { userRepository } from "@/server/repositories/user-repository";
import { credentialRepository } from "@/server/repositories/credential-repository";
import { sessionRepository } from "@/server/repositories/session-repository";
import { authTokenRepository } from "@/server/repositories/auth-token-repository";
import { mailer } from "@/lib/mail/mailer";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";

// `resetPassword()` now records `auth.session.revoked` (Module 08) via a
// `knownActor` override, never `getCurrentUser()` (this flow is
// token-authenticated, no session exists) — but `lib/audit/service.ts`
// still statically imports `session-guard.ts`, which pulls in the real
// `@/auth` (next-auth) module graph. Every other authorization-adjacent
// integration test in this project already mocks this import for
// exactly this reason (see invitation-service.test.ts etc.) — without
// it, this file fails to even load: "Cannot find module
// '.../node_modules/next/server'", a Vite/next-auth resolution quirk
// specific to loading that chain outside a real Next.js server context.
vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => null),
  getCurrentMembership: vi.fn(async () => null),
}));

describe.skipIf(!isDatabaseConfigured)("Password reset service (database integration)", () => {
  const userIds: string[] = [];

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeActiveUser() {
    const id = generateId();
    const user = await userRepository.create({ id, email: `reset-test-${id}@example.com`, name: "Reset Test" });
    await db.user.update({ where: { id }, data: { status: "ACTIVE" } });
    await credentialRepository.create({ id: generateId(), userId: id, passwordHash: await hashPassword("original-password-123") });
    userIds.push(id);
    return user;
  }

  it("requestPasswordReset sends an email with a working link for an existing account", async () => {
    const user = await makeActiveUser();
    const sendSpy = vi.spyOn(mailer, "send").mockResolvedValue();

    await requestPasswordReset({ email: user.email });

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0][0].to).toBe(user.email);
    expect(sendSpy.mock.calls[0][0].text).toContain("/reset-password?token=");
  });

  it("requestPasswordReset is enumeration-safe — resolves the same way for a nonexistent account, without sending mail", async () => {
    const sendSpy = vi.spyOn(mailer, "send").mockResolvedValue();
    await expect(requestPasswordReset({ email: "no-such-account@example.com" })).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("resetPassword changes the password and revokes every live session", async () => {
    const user = await makeActiveUser();
    await sessionRepository.create({ id: generateId(), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });

    const rawToken = generateRawToken();
    await authTokenRepository.create({
      id: generateId(),
      userId: user.id,
      purpose: "PASSWORD_RESET",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await resetPassword({ token: rawToken, password: "brand-new-password-456" });
    expect(result).toBe("reset");

    const credential = await credentialRepository.findByUserId(user.id);
    expect(await verifyPassword(credential!.passwordHash, "brand-new-password-456")).toBe(true);
    expect(await verifyPassword(credential!.passwordHash, "original-password-123")).toBe(false);

    const activeSessions = await sessionRepository.listActiveForUser(user.id);
    expect(activeSessions).toHaveLength(0);
  });

  it("resetPassword rejects an already-used token", async () => {
    const user = await makeActiveUser();
    const rawToken = generateRawToken();
    await authTokenRepository.create({
      id: generateId(),
      userId: user.id,
      purpose: "PASSWORD_RESET",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await resetPassword({ token: rawToken, password: "first-attempt-password" });
    expect(first).toBe("reset");

    const second = await resetPassword({ token: rawToken, password: "second-attempt-password" });
    expect(second).toBe("already_used");
  });

  it("resetPassword rejects an expired token", async () => {
    const user = await makeActiveUser();
    const rawToken = generateRawToken();
    await authTokenRepository.create({
      id: generateId(),
      userId: user.id,
      purpose: "PASSWORD_RESET",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const result = await resetPassword({ token: rawToken, password: "irrelevant-password" });
    expect(result).toBe("expired");
  });

  it("resetPassword rejects an unknown token", async () => {
    const result = await resetPassword({ token: "totally-made-up-token-value", password: "irrelevant-password" });
    expect(result).toBe("invalid");
  });
});
