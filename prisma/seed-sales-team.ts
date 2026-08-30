/**
 * Build 21 (Roadmap Module 15 — Sales Team Management) dev fixtures —
 * a small real roster (a manager and two reps) plus one per-rep quota
 * and one organization-wide target, against the SAME platform accounts
 * `seed-pipeline.ts` already made the actor/assignee of its own seeded
 * deals — so this module's own performance/leaderboard numbers reflect
 * real, already-seeded deal/activity history, not disconnected fixture
 * data.
 *
 * Deliberately uses the REPOSITORY layer directly, never the
 * `crm-sales-team-service.ts`/`crm-sales-goal-service.ts` layer — same
 * reasoning `seed-pipeline.ts`'s own top comment documents (the service
 * layer transitively needs `requirePermission()` -> `session-guard`,
 * which doesn't work inside this bare `tsx` process).
 *
 * Idempotent: guarded by a single find-or-skip check, the same
 * "one guard for the whole fixture set" pattern every prior seed file
 * uses.
 */
import { generateId } from "../src/lib/utils/id";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { userRepository } from "../src/server/repositories/user-repository";
import { crmSalesTeamMemberRepository } from "../src/server/repositories/crm-sales-team-member-repository";
import { crmSalesGoalRepository } from "../src/server/repositories/crm-sales-goal-repository";
import { resolvePeriod } from "../src/lib/billing/reporting/period";

export async function seedSalesTeamFixtures(): Promise<void> {
  const platformOrg = await organizationRepository.findBySlug("alpha-os-platform");
  if (!platformOrg) {
    console.log("[seed-sales-team] Platform organization not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const platformOwner = await userRepository.findByEmail("platform-owner@alpha-os.test");
  const platformAdmin = await userRepository.findByEmail("platform-admin@alpha-os.test");
  const supportAdmin = await userRepository.findByEmail("support-admin@alpha-os.test");
  if (!platformOwner || !platformAdmin || !supportAdmin) {
    console.log("[seed-sales-team] Platform dev accounts not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const existing = await crmSalesTeamMemberRepository.findActiveByOrgAndUser(platformOrg.id, platformOwner.id);
  if (existing) {
    console.log("[seed-sales-team] Sales team fixtures already exist — nothing to do.");
    return;
  }

  const manager = await crmSalesTeamMemberRepository.create({ id: generateId(), organizationId: platformOrg.id, userId: platformOwner.id, managerId: null });
  const rep = await crmSalesTeamMemberRepository.create({ id: generateId(), organizationId: platformOrg.id, userId: platformAdmin.id, managerId: manager.id });
  await crmSalesTeamMemberRepository.create({ id: generateId(), organizationId: platformOrg.id, userId: supportAdmin.id, managerId: manager.id });

  const currentMonth = resolvePeriod("current_month", "UTC", new Date());

  // A per-rep revenue QUOTA for platform-admin — deliberately below the
  // already-seeded $4,500 won deal (`seed-pipeline.ts`'s own "Local
  // landing pages" fixture, won `now()` at seed time, so it always
  // falls inside "current month"), so the rep detail page shows a real,
  // non-trivial attainment percentage out of the box.
  await crmSalesGoalRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    salesTeamMemberId: rep.id,
    kind: "QUOTA",
    metric: "REVENUE_WON",
    valueMinorUnits: 400_000,
    currency: "USD",
    valueCount: null,
    valuePercent: null,
    periodStart: currentMonth.start,
    periodEnd: currentMonth.end,
    periodLabel: currentMonth.label,
    createdByUserId: platformOwner.id,
  });

  // An organization-wide deals-won TARGET (salesTeamMemberId: null).
  await crmSalesGoalRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    salesTeamMemberId: null,
    kind: "TARGET",
    metric: "DEALS_WON",
    valueMinorUnits: null,
    currency: null,
    valueCount: 5,
    valuePercent: null,
    periodStart: currentMonth.start,
    periodEnd: currentMonth.end,
    periodLabel: currentMonth.label,
    createdByUserId: platformOwner.id,
  });

  console.log(`[seed-sales-team] Sales team fixtures seeded for platform organization (${platformOrg.id}): 3 members (1 manager, 2 reports), 2 goals (1 per-rep quota, 1 org-wide target).`);
}
