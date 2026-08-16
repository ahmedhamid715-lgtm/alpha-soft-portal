import { z } from "zod";

/**
 * The client-safe half of the password policy — no `"server-only"`, no
 * `argon2` import. Split out of `password.ts` deliberately: that file's
 * `hashPassword`/`verifyPassword` pull in argon2's native binding, and a
 * client component (the reset-password form, which needs
 * `PASSWORD_MIN_LENGTH` for its hint text) importing anything from that
 * file — even just a constant — drags the entire server-only module,
 * argon2 included, into the browser bundle. Next.js's build correctly
 * fails on that (a real bug this split fixes, found via `npm run build`,
 * not by inspection) — see authentication.md "Security issues found and
 * fixed."
 *
 * See `password.ts` for the full password-policy reasoning (length-based,
 * not composition-based, no trimming) — not repeated here.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
