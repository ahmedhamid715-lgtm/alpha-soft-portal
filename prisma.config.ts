import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 reads connection details and CLI behavior from this file, not
 * from `env("DATABASE_URL")` inside schema.prisma.
 *
 * We deliberately do NOT use prisma/config's `env()` helper here — it
 * throws immediately if the named variable is unset, which would break
 * `prisma generate` (and therefore `npm install` / `npm run build`) on a
 * fresh checkout before a real database is configured. Falling back to a
 * syntactically valid placeholder lets `generate` succeed unconditionally;
 * anything that actually needs a live connection (`migrate dev`, `studio`,
 * real queries at runtime) will fail loudly and specifically instead, which
 * is what we want — see docs/architecture/database.md.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: DATABASE_URL,
  },
});
