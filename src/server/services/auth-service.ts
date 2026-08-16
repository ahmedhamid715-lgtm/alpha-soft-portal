import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { verifyPassword } from "@/lib/auth/password";
import { userRepository } from "@/server/repositories/user-repository";
import { credentialRepository } from "@/server/repositories/credential-repository";
import { sessionRepository } from "@/server/repositories/session-repository";
import { logger } from "@/lib/logging";

/**
 * Authentication business logic — what `auth.ts`'s Credentials provider
 * calls into, kept separate from Auth.js's own config so the actual
 * "verify these credentials" and "record this sign-in" logic is plain,
 * directly testable TypeScript rather than living inside a callback only
 * Auth.js's runtime invokes.
 */

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface AuthenticatedIdentity {
  id: string;
  email: string;
  name: string;
}

/**
 * Verifies email + password. Returns `null` for EVERY failure mode
 * (account doesn't exist, wrong password, no credential set, account not
 * ACTIVE) — the caller (Auth.js's `authorize()`) must not be able to
 * distinguish "wrong password" from "no such account" from the return
 * value alone, which is what actually prevents account enumeration
 * through the login form itself (see authentication.md "Enumeration
 * protection").
 *
 * Deliberately still runs `verifyPassword` against a fixed dummy hash
 * when the account doesn't exist, so a nonexistent-email attempt takes
 * roughly the same wall-clock time as a wrong-password attempt against a
 * real account — a real, if narrow, timing side-channel otherwise.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$3ZlnlCa8+Si4tqbHAnRqMFvWu3QfH4zysPGX7buE0mI";

export async function verifyCredentials(rawInput: unknown): Promise<AuthenticatedIdentity | null> {
  const parsed = credentialsSchema.safeParse(rawInput);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;
  const user = await userRepository.findByEmail(email);

  if (!user || user.status !== "ACTIVE") {
    await verifyPassword(DUMMY_HASH, password); // constant-time-ish decoy — see doc comment above
    logger.info("Login attempt failed.", { operation: "auth.login", reason: user ? "account_not_active" : "no_such_account" });
    return null;
  }

  const credential = await credentialRepository.findByUserId(user.id);
  if (!credential) {
    await verifyPassword(DUMMY_HASH, password);
    logger.info("Login attempt failed.", { operation: "auth.login", reason: "no_credential_set", userId: user.id });
    return null;
  }

  const valid = await verifyPassword(credential.passwordHash, password);
  if (!valid) {
    logger.info("Login attempt failed.", { operation: "auth.login", reason: "wrong_password", userId: user.id });
    return null;
  }

  logger.info("Login succeeded.", { operation: "auth.login", userId: user.id });
  return { id: user.id, email: user.email, name: user.name };
}

/** Session lifetime — see authentication.md "Session strategy" for why this (not the JWT's own `maxAge`) is the authoritative expiry. */
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Creates this module's own `UserSession` row at sign-in time and records
 * `User.lastLoginAt` — called from `auth.ts`'s `jwt` callback on
 * `trigger === "signIn"`. `userAgent` is truncated defensively; it's
 * informational (a future "your active sessions" list), not a
 * fingerprinting mechanism — see prisma/schema.prisma's `UserSession`
 * comment.
 */
export async function createUserSession(userId: string, userAgent?: string | null): Promise<string> {
  const sessionId = generateId();
  await sessionRepository.create({
    id: sessionId,
    userId,
    userAgent: userAgent ? userAgent.slice(0, 255) : null,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  });
  await userRepository.recordLogin(userId);
  return sessionId;
}
