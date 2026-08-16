import "server-only";
import { generateId } from "@/lib/utils/id";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import { sendVerificationEmail } from "@/lib/mail/mailer";
import { userRepository } from "@/server/repositories/user-repository";
import { authTokenRepository } from "@/server/repositories/auth-token-repository";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import { logger } from "@/lib/logging";
import { appConfig } from "@/config/app";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Issues a new email-verification token, invalidating any earlier live
 * one first (spec section 11). Silent no-op if the user doesn't exist or
 * is already verified — this function is called from contexts that
 * already know the user exists (e.g. right after the seed script/a
 * future invite flow creates one), so it doesn't need the enumeration-
 * safety wrapper `requestPasswordReset` below has; it's not exposed
 * directly on a public "resend verification" form in this module.
 */
export async function issueEmailVerificationToken(userId: string): Promise<void> {
  const user = await userRepository.findById(userId);
  if (!user || user.emailVerifiedAt) return;

  await authTokenRepository.invalidateLiveForUser(userId, "EMAIL_VERIFICATION");

  const rawToken = generateRawToken();
  await authTokenRepository.create({
    id: generateId(),
    userId,
    purpose: "EMAIL_VERIFICATION",
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  });

  const verificationUrl = `${appConfig.url}/verify-email?token=${rawToken}`;
  await sendVerificationEmail(user.email, verificationUrl);
}

export type VerifyEmailResult = "verified" | "invalid" | "expired" | "already_used";

/**
 * Consumes a raw token (from the `?token=` query param) — looks it up by
 * hash, checks expiry and single-use, and if valid marks
 * `User.emailVerifiedAt`. Every failure mode returns a distinct result
 * (not a thrown error) so the page can show an accurate, safe message —
 * "invalid"/"expired"/"already_used" are all fine to distinguish here
 * (unlike login/forgot-password) since a verification link isn't a
 * secret whose existence needs hiding, it's a one-time action the user
 * just clicked from their own email.
 */
export async function verifyEmail(rawToken: string): Promise<VerifyEmailResult> {
  const tokenHash = hashToken(rawToken);
  const token = await authTokenRepository.findByTokenHash(tokenHash);

  if (!token || token.purpose !== "EMAIL_VERIFICATION") return "invalid";
  if (token.consumedAt) return "already_used";
  if (token.expiresAt.getTime() < Date.now()) return "expired";

  await withDbErrorTranslation(() =>
    db.$transaction([
      db.authToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } }),
      db.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } }),
    ]),
  );

  logger.info("Email verified.", { operation: "auth.verifyEmail", userId: token.userId });
  return "verified";
}
