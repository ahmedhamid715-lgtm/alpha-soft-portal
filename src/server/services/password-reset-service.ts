import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/auth/password-policy";
import { sendPasswordResetEmail } from "@/lib/mail/mailer";
import { userRepository } from "@/server/repositories/user-repository";
import { credentialRepository } from "@/server/repositories/credential-repository";
import { authTokenRepository } from "@/server/repositories/auth-token-repository";
import { sessionRepository } from "@/server/repositories/session-repository";
import { parseOrThrow } from "@/lib/validation/parse";
import { logger } from "@/lib/logging";
import { appConfig } from "@/config/app";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour — short-lived, per spec section 12

export const requestPasswordResetSchema = z.object({ email: z.string().email() });

/**
 * Issues a reset token IF the account exists — but always returns the
 * same way regardless (spec section 12/15: "do not reveal whether an
 * account exists"). The caller (the forgot-password action) shows the
 * identical "If an account exists, we've sent instructions" message
 * whether this function actually sent an email or silently did nothing;
 * that symmetry is the entire enumeration defense, so it belongs here,
 * not as an afterthought at the UI layer.
 */
export async function requestPasswordReset(rawInput: unknown): Promise<void> {
  const { email } = parseOrThrow(requestPasswordResetSchema, rawInput);
  const user = await userRepository.findByEmail(email);

  // No early return with a different code path visible to a timing
  // attacker beyond "one DB query vs. two" — acceptable here since
  // request-level rate limiting (see the forgot-password action) is the
  // real defense against automated enumeration, not sub-millisecond
  // timing symmetry on top of it.
  if (!user || user.status !== "ACTIVE") {
    logger.info("Password reset requested for a non-resettable account.", {
      operation: "auth.requestPasswordReset",
      reason: user ? "account_not_active" : "no_such_account",
    });
    return;
  }

  await authTokenRepository.invalidateLiveForUser(user.id, "PASSWORD_RESET");

  const rawToken = generateRawToken();
  await authTokenRepository.create({
    id: generateId(),
    userId: user.id,
    purpose: "PASSWORD_RESET",
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  const resetUrl = `${appConfig.url}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);
  logger.info("Password reset requested.", { operation: "auth.requestPasswordReset", userId: user.id });
}

export type ResetPasswordResult = "reset" | "invalid" | "expired" | "already_used";

export const resetPasswordSchema = z.object({ token: z.string().min(1), password: passwordSchema });

/**
 * Consumes a reset token and sets a new password. On success,
 * invalidates every one of the user's live sessions (spec section 9:
 * "revoke sessions after password reset") — a password reset is exactly
 * the moment an attacker with a stolen session should lose it, whether
 * or not the reset was performed by the account's legitimate owner.
 */
export async function resetPassword(rawInput: unknown): Promise<ResetPasswordResult> {
  const { token: rawToken, password } = parseOrThrow(resetPasswordSchema, rawInput);
  const tokenHash = hashToken(rawToken);
  const token = await authTokenRepository.findByTokenHash(tokenHash);

  if (!token || token.purpose !== "PASSWORD_RESET") return "invalid";
  if (token.consumedAt) return "already_used";
  if (token.expiresAt.getTime() < Date.now()) return "expired";

  const passwordHash = await hashPassword(password);

  await authTokenRepository.markConsumed(token.id);
  await credentialRepository.updatePassword(token.userId, passwordHash);
  await sessionRepository.revokeAllForUser(token.userId, "password_reset");

  logger.info("Password reset completed; all sessions revoked.", {
    operation: "auth.resetPassword",
    userId: token.userId,
  });
  return "reset";
}
