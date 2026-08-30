/**
 * Development seed script (spec section 27).
 *
 * DEVELOPMENT-ONLY. Refuses to run when NODE_ENV=production. Contains no
 * real credentials — every identity here is an obviously-fake `*.test`
 * address with a hardcoded dev-only password (never a real Alpha Page
 * Rankers account, never reused anywhere real), created so the auth flows
 * (login, role-aware routing) can actually be exercised end to end
 * without a public signup flow, which this module deliberately doesn't
 * build (see docs/architecture/authentication.md "No business logic").
 *
 * Creates one development organization with three memberships — one per
 * destination-routing role (spec section 33) — via
 * `createOrganizationWithOwner` for the first (the same service a real
 * "create org" flow calls) and the repository layer directly for the
 * other two, so the seed script doubles as a smoke test that the
 * service/repository/transaction layer actually works end to end.
 *
 * Reset strategy: `npx prisma migrate reset` drops and re-migrates the
 * dev database, then re-runs this script automatically (Prisma's
 * built-in behavior for the `migrations.seed` command in
 * prisma.config.ts) — that's the supported way to get back to a known
 * state, not a hand-rolled "delete everything" script here.
 */
import { db } from "../src/lib/db/client";
import { generateId } from "../src/lib/utils/id";
import { hashPassword } from "../src/lib/auth/password";
import { createOrganizationWithOwner } from "../src/server/services/organization-service";
import { userRepository } from "../src/server/repositories/user-repository";
import { credentialRepository } from "../src/server/repositories/credential-repository";
import { membershipRepository } from "../src/server/repositories/membership-repository";
import { seedRbac, seedAuthorizationFixtures } from "./seed-rbac";
import { seedUserOrgManagementFixtures } from "./seed-user-org-management";
import { seedNotificationFixtures } from "./seed-notifications";
import { seedUserManagementFixtures } from "./seed-user-management";
import { seedBillingFixtures } from "./seed-billing";
import { seedCrmFixtures } from "./seed-crm";
import { seedPipelineFixtures } from "./seed-pipeline";
import { seedSalesTeamFixtures } from "./seed-sales-team";

/** Obviously a dev fixture, not a real password — satisfies the length-based policy (12+ chars). Never used outside this script. */
const DEV_PASSWORD = "alpha-os-dev-password";

async function activateWithPassword(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
  await credentialRepository.create({ id: generateId(), userId, passwordHash: await hashPassword(DEV_PASSWORD) });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed script in production.");
  }

  // Module 05 (RBAC) — the permission/role catalog and its own dev
  // fixtures. Called before the early-return below (not after) so both
  // still run on a repeat `npm run db:seed` invocation where Module 04's
  // own dev organization already exists — each is independently
  // idempotent (see prisma/seed-rbac.ts), so this is always safe.
  await seedRbac();
  await seedAuthorizationFixtures();
  await seedUserOrgManagementFixtures();
  await seedNotificationFixtures();
  await seedUserManagementFixtures();
  await seedBillingFixtures();
  await seedCrmFixtures();
  await seedPipelineFixtures();
  await seedSalesTeamFixtures();

  const existing = await db.organization.findUnique({ where: { slug: "alpha-page-rankers-dev" } });
  if (existing) {
    console.log("[seed] Dev organization already exists — nothing to do. Run `prisma migrate reset` to start fresh.");
    return;
  }

  const { organization, membership: ownerMembership } = await createOrganizationWithOwner({
    organization: {
      name: "Alpha Page Rankers (Dev)",
      displayName: "Alpha Page Rankers",
      slug: "alpha-page-rankers-dev",
      timezone: "America/New_York",
      locale: "en-US",
      currency: "USD",
    },
    owner: { email: "owner@alpha-os.test", name: "Dev Owner" },
  });
  await activateWithPassword(ownerMembership.userId);

  const supportUser = await userRepository.create({ id: generateId(), email: "support@alpha-os.test", name: "Dev Support" });
  await membershipRepository.create({ id: generateId(), organizationId: organization.id, userId: supportUser.id, role: "support" });
  await activateWithPassword(supportUser.id);

  const customerUser = await userRepository.create({ id: generateId(), email: "customer@alpha-os.test", name: "Dev Customer" });
  await membershipRepository.create({ id: generateId(), organizationId: organization.id, userId: customerUser.id, role: "member" });
  await activateWithPassword(customerUser.id);

  console.log(`[seed] Created organization "${organization.displayName}" (${organization.id}).`);
  console.log("[seed] Three dev accounts ready (password for all: alpha-os-dev-password):");
  console.log(`[seed]   owner@alpha-os.test    role=owner    -> /organizations/${organization.id}`);
  console.log("[seed]   support@alpha-os.test  role=support  -> /support");
  console.log("[seed]   customer@alpha-os.test role=member   -> /dashboard");
}

main()
  .catch((error) => {
    console.error("[seed] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
