/**
 * Development seed script (spec section 34).
 *
 * DEVELOPMENT-ONLY. Refuses to run when NODE_ENV=production. Never place
 * real credentials, real customer data, or production account records in
 * this file or anything it generates.
 *
 * Module 01 has no business schema yet (see prisma/schema.prisma), so
 * there is nothing to seed — this file exists to establish the pattern
 * (`npm run db:seed`, guarded against production, logged clearly) that
 * Module 03 fills in once real entities exist. It deliberately does NOT
 * create Admin/Support/Customer accounts — that's Module 04's
 * (Authentication) job, once password hashing and the User model exist.
 *
 * Reset strategy: `npx prisma migrate reset` drops and re-migrates the
 * dev database, then re-runs this script automatically (Prisma's
 * built-in behavior for the `migrations.seed` command in
 * prisma.config.ts) — that's the supported way to get back to a known
 * state, not a hand-rolled "delete everything" script here.
 */
import { db } from "../src/lib/db/client";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed script in production.");
  }

  console.log("[seed] Module 01 has no business schema yet — nothing to seed.");
  console.log("[seed] Module 03 (Database Architecture) will add real seed data here.");
}

main()
  .catch((error) => {
    console.error("[seed] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
