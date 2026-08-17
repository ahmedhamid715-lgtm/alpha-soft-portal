import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { issueEmailVerificationToken, verifyEmail } from "@/server/services/email-verification-service";
import { userRepository } from "@/server/repositories/user-repository";
import { authTokenRepository } from "@/server/repositories/auth-token-repository";
import { emailProvider } from "@/lib/mail/mailer";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";

describe.skipIf(!isDatabaseConfigured)("Email verification service (database integration)", () => {
  const userIds: string[] = [];

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeUnverifiedUser() {
    const id = generateId();
    const user = await userRepository.create({ id, email: `verify-test-${id}@example.com`, name: "Verify Test" });
    userIds.push(id);
    return user;
  }

  it("issueEmailVerificationToken sends an email with a working link", async () => {
    const user = await makeUnverifiedUser();
    const sendSpy = vi.spyOn(emailProvider, "send").mockResolvedValue({ accepted: true });

    await issueEmailVerificationToken(user.id);

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0][0].to).toBe(user.email);
    expect(sendSpy.mock.calls[0][0].text).toContain("/verify-email?token=");
  });

  it("issueEmailVerificationToken is a no-op for an already-verified user", async () => {
    const user = await makeUnverifiedUser();
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const sendSpy = vi.spyOn(emailProvider, "send").mockResolvedValue({ accepted: true });

    await issueEmailVerificationToken(user.id);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("verifyEmail marks the user verified and active, and consumes the token", async () => {
    const user = await makeUnverifiedUser();
    const rawToken = generateRawToken();
    await authTokenRepository.create({
      id: generateId(),
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await verifyEmail(rawToken);
    expect(result).toBe("verified");

    const updated = await userRepository.findById(user.id);
    expect(updated?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(updated?.status).toBe("ACTIVE");
  });

  it("verifyEmail rejects a reused token", async () => {
    const user = await makeUnverifiedUser();
    const rawToken = generateRawToken();
    await authTokenRepository.create({
      id: generateId(),
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await verifyEmail(rawToken)).toBe("verified");
    expect(await verifyEmail(rawToken)).toBe("already_used");
  });

  it("verifyEmail rejects an expired token", async () => {
    const user = await makeUnverifiedUser();
    const rawToken = generateRawToken();
    await authTokenRepository.create({
      id: generateId(),
      userId: user.id,
      purpose: "EMAIL_VERIFICATION",
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await verifyEmail(rawToken)).toBe("expired");
  });

  it("verifyEmail rejects an unknown token", async () => {
    expect(await verifyEmail("not-a-real-token")).toBe("invalid");
  });
});
