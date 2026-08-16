import "server-only";
import argon2 from "argon2";

/**
 * Password hashing (spec section 4) — server-only, argon2-dependent.
 * Policy constants/schema (client-safe) live in `password-policy.ts`
 * instead — see that file's comment for why they're split.
 *
 * **Argon2id**, not bcrypt — this project's Node.js runtime (Prisma
 * already requires it; Next.js 16's `proxy.ts` defaults to it too, see
 * docs/architecture/platform-core.md) has no edge-runtime constraint that
 * would make Argon2id's native binding impractical, so there's no reason
 * to reach for the weaker fallback. `argon2`'s own library defaults
 * (Argon2id, 64 MiB memory, 3 iterations, 4-way parallelism, 32-byte
 * output) already match current OWASP password-storage guidance — used
 * as-is rather than re-tuned, since second-guessing a security library's
 * own documented defaults without a specific reason is how "improvements"
 * quietly become mistakes.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext);
}

/**
 * Constant-time verification (argon2's own guarantee — never implement
 * this comparison by hand). Returns `false` for a wrong password OR a
 * malformed hash — never throws for "the password didn't match," only
 * for a genuine internal error, so callers can treat any non-throwing
 * `false` as "authentication failed," full stop.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
