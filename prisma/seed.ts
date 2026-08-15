/**
 * Development seed script (spec section 27).
 *
 * DEVELOPMENT-ONLY. Refuses to run when NODE_ENV=production. Contains no
 * real credentials — there's nothing to hash yet (Module 04 owns
 * authentication), and every identity here is an obviously-fake
 * `*.test`/`*.example` address, never a real Alpha Page Rankers account.
 *
 * Creates one development organization with one owner membership, via
 * `createOrganizationWithOwner` (the same service a real "create org"
 * flow will call later) rather than raw `db.organization.create` calls —
 * so the seed script doubles as a smoke test that the service/repository/
 * transaction layer actually works end to end.
 *
 * Reset strategy: `npx prisma migrate reset` drops and re-migrates the
 * dev database, then re-runs this script automatically (Prisma's
 * built-in behavior for the `migrations.seed` command in
 * prisma.config.ts) — that's the supported way to get back to a known
 * state, not a hand-rolled "delete everything" script here.
 */
import { db } from "../src/lib/db/client";
import { createOrganizationWithOwner } from "../src/server/services/organization-service";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed script in production.");
  }

  const existing = await db.organization.findUnique({ where: { slug: "alpha-page-rankers-dev" } });
  if (existing) {
    console.log("[seed] Dev organization already exists — nothing to do. Run `prisma migrate reset` to start fresh.");
    return;
  }

  const { organization, membership } = await createOrganizationWithOwner({
    organization: {
      name: "Alpha Page Rankers (Dev)",
      displayName: "Alpha Page Rankers",
      slug: "alpha-page-rankers-dev",
      timezone: "America/New_York",
      locale: "en-US",
      currency: "USD",
    },
    owner: {
      email: "owner@alpha-os.test",
      name: "Dev Owner",
    },
  });

  console.log(`[seed] Created organization "${organization.displayName}" (${organization.id}).`);
  console.log(`[seed] Created owner membership (${membership.id}), role="${membership.role}".`);
  console.log("[seed] No password/session exists yet — Module 04 (Authentication) adds real sign-in.");
}

main()
  .catch((error) => {
    console.error("[seed] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
