import { z } from "zod";

/**
 * Public (client-safe) environment configuration.
 *
 * Only `NEXT_PUBLIC_*` variables belong here — anything in this file may
 * end up in the browser bundle. Never re-export a value from
 * `environment.ts` (server-only) through this module.
 *
 * Next.js inlines `NEXT_PUBLIC_*` values at build time via static analysis
 * of `process.env.NEXT_PUBLIC_X` references, so those keys must be
 * referenced literally (not through dynamic property access) wherever
 * they're used directly in client components. This module exists for
 * server components and utility code that want a validated, typed view of
 * the same values.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function loadPublicEnv(): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid public environment configuration:\n${issues}`);
  }

  return result.data;
}

export const publicEnv = loadPublicEnv();
