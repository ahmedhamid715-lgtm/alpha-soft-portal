import "server-only";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * This module is the ONLY place `process.env` should be read directly for
 * server-only values. Everything else in the application should import
 * `serverEnv` from here instead of touching `process.env` directly — that
 * keeps validation, defaults, and typing in one place.
 *
 * Importing `server-only` guarantees a build-time error if this module is
 * ever pulled into a client bundle, even by accident (see
 * docs/architecture/security.md).
 *
 * Variables are grouped by the categories this platform will grow into.
 * A variable being `.optional()` here means Module 1 does not yet depend
 * on it being set — the module that introduces the feature (noted in each
 * comment) is responsible for treating it as required once that feature
 * ships. This lets `npm run dev` boot cleanly on a fresh checkout before
 * every downstream module exists.
 */
const serverEnvSchema = z.object({
  // --- Application ---
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Database (infrastructure: Module 01; entities: Module 03) ---
  // Postgres connection string, consumed by prisma.config.ts and by the
  // pg driver adapter in lib/db. Prisma 7 removed the separate `directUrl`
  // migrations concept — driver adapters handle migrations over the same
  // connection automatically, so only one URL is needed.
  DATABASE_URL: z.string().url().optional(),

  // --- Authentication (Module 04) ---
  // Secret used to sign session tokens. Required once Module 04 lands;
  // must be a high-entropy random string (32+ bytes).
  AUTH_SECRET: z.string().min(32).optional(),

  // --- AI (Module 33 — AI Core) ---
  // Claude is the primary provider (see shared/claude-api skill conventions
  // used elsewhere in this project — always the official Anthropic SDK).
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // OpenAI is a planned secondary provider, decided during Module 01 but
  // implemented in Module 33 — these are reserved now purely so the env
  // schema doesn't need revisiting when that lands. No OpenAI SDK code
  // exists yet; do not add integration logic in Module 01.
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_CHAT_MODEL: z.string().min(1).optional(),

  // --- Observability (Module 58 formalizes this; logger uses it now) ---
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

function loadServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      [
        "Invalid or missing environment configuration:",
        formatIssues(result.error),
        "",
        "Check .env.example for the full list of supported variables,",
        "then create a .env.local with the values you need.",
      ].join("\n"),
    );
  }

  return result.data;
}

/**
 * Validated, typed server environment. Import this instead of reading
 * `process.env` directly anywhere else in server-side code.
 */
export const serverEnv = loadServerEnv();

/**
 * Whether the database connection has been configured at all. Modules that
 * depend on Prisma (starting with Module 03) should check this before
 * assuming `DATABASE_URL` is usable — see lib/db for the guarded client.
 */
export const isDatabaseConfigured = Boolean(serverEnv.DATABASE_URL);

/** Whether the Anthropic API key is configured (relevant from Module 33 on). */
export const isAnthropicConfigured = Boolean(serverEnv.ANTHROPIC_API_KEY);
