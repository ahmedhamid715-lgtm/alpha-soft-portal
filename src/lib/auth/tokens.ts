import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Secure single-use tokens for email verification and password reset
 * (spec sections 11 & 12). The raw token is generated here, sent to the
 * user (email), and never persisted — only its SHA-256 hash is stored
 * (`AuthToken.tokenHash`), so a database read alone (a backup, a
 * compromised read replica, a careless log line) can never yield a
 * usable token. This is the "safer hashed-token approach" the spec asks
 * for explicitly, and it's also exactly how Auth.js's own default
 * `VerificationToken` adapter model works — same idea, applied to a
 * table this module owns instead of Auth.js's adapter.
 */
const TOKEN_BYTES = 32; // 256 bits of entropy — well above what's brute-forceable.

export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Constant-time comparison for the rare case a raw token needs comparing
 * directly (it doesn't, normally — `hashToken` + a database unique lookup
 * on `tokenHash` is the actual verification path, and that lookup is
 * already not a timing oracle since it's an equality index lookup, not a
 * loop). Kept for defense in depth / explicitness at call sites that
 * genuinely compare two token strings.
 */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
