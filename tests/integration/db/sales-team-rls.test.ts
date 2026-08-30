import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Restricted-role RLS/constraint proofs for Build 21 (Sales Team
 * Management, Roadmap Module 15) — direct style/helper template from
 * `sales-pipeline-rls.test.ts` (Build 20). Real Postgres, real
 * restricted `alpha_os_app` role via `withTenantContext()` — never the
 * superuser connection, which would bypass RLS and prove nothing. See
 * `prisma/migrations/20260830202000_sales_team_management/migration.sql`
 * for the exact constraints/policies/trigger this file proves.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Sales Team Row-Level Security (database integration)", () => {
  let customerOrgId: string;
  let platformOrgId: string;
  let actorUserId: string;
  const memberIds: string[] = [];
  const goalIds: string[] = [];
  const userIds: string[] = [];

  const platformContext = () => ({ userId: actorUserId, organizationId: platformOrgId, isPlatformStaff: true });
  const customerContext = () => ({ userId: null, organizationId: customerOrgId, isPlatformStaff: false });

  beforeEach(async () => {
    customerOrgId = generateId();
    await organizationRepository.create({
      id: customerOrgId,
      name: "Sales Team RLS Customer Org",
      displayName: "Sales Team RLS Customer Org",
      slug: `sales-team-rls-customer-${customerOrgId}`,
    });

    platformOrgId = (await organizationRepository.findPlatformOrganization())!.id;
    actorUserId = (await db.organizationMembership.findFirst({
      where: { organizationId: platformOrgId, status: "ACTIVE" },
      select: { userId: true },
    }))!.userId;
  });

  afterEach(async () => {
    // Goals reference members; delete children before parents. Scoped,
    // never a blanket deleteMany({}) — test files run concurrently
    // against the same real database.
    if (goalIds.length) await db.crmSalesGoal.deleteMany({ where: { id: { in: goalIds } } });
    if (memberIds.length) await db.crmSalesTeamMember.deleteMany({ where: { id: { in: memberIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.organization.delete({ where: { id: customerOrgId } });

    memberIds.length = 0;
    goalIds.length = 0;
    userIds.length = 0;
  });

  /**
   * Always a FRESH user unless `userId` is explicitly given — never
   * defaults to the shared `actorUserId`, which is a real, already-
   * seeded platform account that may already have its own real ACTIVE
   * `crm_sales_team_member` row (Build 21's own dev fixtures,
   * `seed-sales-team.ts`). Reusing it here would collide with the
   * partial unique index on completely unrelated grounds — found via a
   * real failing run against this exact shared dev database, not a
   * hypothetical.
   */
  async function seedMember(organizationId: string, options: { managerId?: string | null; userId?: string } = {}) {
    let userId = options.userId;
    if (!userId) {
      const user = await userRepository.create({ id: generateId(), email: `sales-team-rls-${generateId()}@example.com`, name: "Sales Team RLS Fixture User" });
      userIds.push(user.id);
      userId = user.id;
    }
    const member = await withTenantContext(
      organizationId === platformOrgId ? platformContext() : customerContext(),
      (tx) =>
        tx.crmSalesTeamMember.create({
          data: { id: generateId(), organizationId, userId: userId!, managerId: options.managerId ?? null },
        }),
    );
    memberIds.push(member.id);
    return member;
  }

  async function seedGoal(
    organizationId: string,
    options: {
      salesTeamMemberId?: string | null;
      kind?: "TARGET" | "QUOTA";
      metric?: "REVENUE_WON" | "DEALS_WON" | "CALLS_LOGGED" | "APPOINTMENTS_LOGGED" | "LEAD_CONVERSION_RATE";
      valueMinorUnits?: number | null;
      currency?: string | null;
      valueCount?: number | null;
      valuePercent?: number | null;
      periodStart?: Date;
      periodEnd?: Date;
      status?: "ACTIVE" | "ARCHIVED";
    } = {},
  ) {
    const goal = await withTenantContext(organizationId === platformOrgId ? platformContext() : customerContext(), (tx) =>
      tx.crmSalesGoal.create({
        data: {
          id: generateId(),
          organizationId,
          salesTeamMemberId: options.salesTeamMemberId ?? null,
          kind: options.kind ?? "TARGET",
          metric: options.metric ?? "DEALS_WON",
          valueMinorUnits: options.valueMinorUnits ?? null,
          currency: options.currency ?? null,
          valueCount: options.metric === undefined || options.metric === "DEALS_WON" || options.metric === "CALLS_LOGGED" || options.metric === "APPOINTMENTS_LOGGED" ? (options.valueCount ?? 5) : (options.valueCount ?? null),
          valuePercent: options.valuePercent ?? null,
          periodStart: options.periodStart ?? new Date("2026-01-01T00:00:00Z"),
          periodEnd: options.periodEnd ?? new Date("2026-02-01T00:00:00Z"),
          periodLabel: "current_month",
          createdByUserId: actorUserId,
          status: options.status ?? "ACTIVE",
        },
      }),
    );
    goalIds.push(goal.id);
    return goal;
  }

  describe("crm_sales_team_members (direct ownership)", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seedMember(platformOrgId);
      const seen = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.crmSalesTeamMember.findMany({}));
      expect(seen).toEqual([]);
    });

    it("the customer organization cannot SELECT a platform-owned member", async () => {
      const member = await seedMember(platformOrgId);
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmSalesTeamMember.findUnique({ where: { id: member.id } }));
      expect(seen).toBeNull();
    });

    it("a zero-WHERE findMany() under the customer context never returns a platform-owned member", async () => {
      await seedMember(platformOrgId);
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmSalesTeamMember.findMany({}));
      expect(seen.every((m) => m.organizationId !== platformOrgId)).toBe(true);
    });

    it("the customer organization cannot UPDATE a platform-owned member (forgotten-WHERE proof)", async () => {
      const member = await seedMember(platformOrgId);
      const result = await withTenantContext(customerContext(), (tx) => tx.crmSalesTeamMember.updateMany({ data: { status: "INACTIVE" } }));
      expect(result.count).toBe(0);
      expect((await db.crmSalesTeamMember.findUnique({ where: { id: member.id } }))?.status).toBe("ACTIVE");
    });

    it("a legitimate INSERT under the platform context succeeds", async () => {
      const member = await seedMember(platformOrgId);
      expect(member.organizationId).toBe(platformOrgId);
    });

    it("DELETE is refused outright even for the platform context (no DELETE grant at all)", async () => {
      const member = await seedMember(platformOrgId);
      await expect(withTenantContext(platformContext(), (tx) => tx.crmSalesTeamMember.delete({ where: { id: member.id } }))).rejects.toThrow();
    });
  });

  describe("crm_sales_team_members_one_active_per_user (partial unique index)", () => {
    it("rejects a second ACTIVE row for the same (organization, user)", async () => {
      const user = await userRepository.create({ id: generateId(), email: `sales-team-rls-${generateId()}@example.com`, name: "Sales Team RLS Duplicate User" });
      userIds.push(user.id);

      await seedMember(platformOrgId, { userId: user.id });
      await expect(seedMember(platformOrgId, { userId: user.id })).rejects.toThrow();
    });

    it("an INACTIVE row does not block a new ACTIVE one for the same user (rejoin)", async () => {
      const user = await userRepository.create({ id: generateId(), email: `sales-team-rls-${generateId()}@example.com`, name: "Sales Team RLS Rejoin User" });
      userIds.push(user.id);

      const first = await seedMember(platformOrgId, { userId: user.id });
      await withTenantContext(platformContext(), (tx) => tx.crmSalesTeamMember.update({ where: { id: first.id }, data: { status: "INACTIVE", leftAt: new Date() } }));
      const second = await seedMember(platformOrgId, { userId: user.id });
      expect(second.id).not.toBe(first.id);
    });
  });

  describe("crm_sales_team_enforce_relationship_integrity — manager_id", () => {
    it("rejects a manager_id pointing at a different organization's member row", async () => {
      // RLS's own INSERT policy already requires `tenant_is_platform_
      // context()`, so a genuinely customer-scoped context can never
      // create ANY row on this table at all — the org-mismatch scenario
      // the trigger defends against is a caller that (like a real bug)
      // sets `organizationId: customerOrgId` while ALSO asserting
      // `isPlatformStaff: true`. That combination legitimately passes
      // RLS's own INSERT check (org matches, platform flag is set) and
      // produces a genuinely persisted customer-org row — exactly the
      // hypothetical the trigger's own migration comment names. The
      // manager row is then invisible under the real platform context's
      // own RLS SELECT policy, so the trigger's lookup returns NULL,
      // which correctly fails the same organization-match check either
      // way.
      const foreignUser = await userRepository.create({ id: generateId(), email: `sales-team-rls-${generateId()}@example.com`, name: "Sales Team RLS Foreign Manager" });
      userIds.push(foreignUser.id);
      const foreignManager = await withTenantContext({ userId: actorUserId, organizationId: customerOrgId, isPlatformStaff: true }, (tx) =>
        tx.crmSalesTeamMember.create({ data: { id: generateId(), organizationId: customerOrgId, userId: foreignUser.id } }),
      );
      memberIds.push(foreignManager.id);

      const forgedId = generateId();
      memberIds.push(forgedId);
      const anotherUser = await userRepository.create({ id: generateId(), email: `sales-team-rls-${generateId()}@example.com`, name: "Sales Team RLS Report User" });
      userIds.push(anotherUser.id);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmSalesTeamMember.create({ data: { id: forgedId, organizationId: platformOrgId, userId: anotherUser.id, managerId: foreignManager.id } }),
        ),
      ).rejects.toThrow();
    });

    it("accepts a manager_id pointing at a same-organization member row (positive control)", async () => {
      const manager = await seedMember(platformOrgId);
      const report = await seedMember(platformOrgId, { managerId: manager.id });
      expect(report.managerId).toBe(manager.id);
    });
  });

  describe("crm_sales_goals (direct ownership)", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seedGoal(platformOrgId);
      const seen = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.crmSalesGoal.findMany({}));
      expect(seen).toEqual([]);
    });

    it("the customer organization cannot SELECT a platform-owned goal", async () => {
      const goal = await seedGoal(platformOrgId);
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmSalesGoal.findUnique({ where: { id: goal.id } }));
      expect(seen).toBeNull();
    });

    it("the customer organization cannot UPDATE a platform-owned goal (forgotten-WHERE proof)", async () => {
      const goal = await seedGoal(platformOrgId);
      const result = await withTenantContext(customerContext(), (tx) => tx.crmSalesGoal.updateMany({ data: { status: "ARCHIVED" } }));
      expect(result.count).toBe(0);
      expect((await db.crmSalesGoal.findUnique({ where: { id: goal.id } }))?.status).toBe("ACTIVE");
    });

    it("DELETE is refused outright even for the platform context (no DELETE grant at all)", async () => {
      const goal = await seedGoal(platformOrgId);
      await expect(withTenantContext(platformContext(), (tx) => tx.crmSalesGoal.delete({ where: { id: goal.id } }))).rejects.toThrow();
    });
  });

  describe("crm_sales_team_enforce_relationship_integrity — sales_team_member_id", () => {
    it("rejects a sales_team_member_id pointing at a different organization's member row", async () => {
      // Same forged-context construction as the manager_id test above —
      // see that test's own comment for why a genuinely customer-scoped
      // context can never reach this table at all under real RLS.
      const foreignUser = await userRepository.create({ id: generateId(), email: `sales-team-rls-${generateId()}@example.com`, name: "Sales Team RLS Foreign Member" });
      userIds.push(foreignUser.id);
      const foreignMember = await withTenantContext({ userId: actorUserId, organizationId: customerOrgId, isPlatformStaff: true }, (tx) =>
        tx.crmSalesTeamMember.create({ data: { id: generateId(), organizationId: customerOrgId, userId: foreignUser.id } }),
      );
      memberIds.push(foreignMember.id);

      await expect(seedGoal(platformOrgId, { salesTeamMemberId: foreignMember.id })).rejects.toThrow();
    });

    it("accepts a sales_team_member_id pointing at a same-organization member row (positive control)", async () => {
      const member = await seedMember(platformOrgId);
      const goal = await seedGoal(platformOrgId, { salesTeamMemberId: member.id });
      expect(goal.salesTeamMemberId).toBe(member.id);
    });

    it("accepts NULL sales_team_member_id (an organization-wide goal, positive control)", async () => {
      const goal = await seedGoal(platformOrgId, { salesTeamMemberId: null });
      expect(goal.salesTeamMemberId).toBeNull();
    });
  });

  describe("crm_sales_goals CHECK constraints", () => {
    it("accepts a valid REVENUE_WON goal (positive control)", async () => {
      const goal = await seedGoal(platformOrgId, { metric: "REVENUE_WON", valueMinorUnits: 100_000, currency: "USD", valueCount: null });
      expect(goal.valueMinorUnits).toBe(100_000);
    });

    it("rejects a REVENUE_WON goal missing currency", async () => {
      await expect(seedGoal(platformOrgId, { metric: "REVENUE_WON", valueMinorUnits: 100_000, currency: null, valueCount: null })).rejects.toThrow();
    });

    it("rejects a DEALS_WON goal that also sets value_minor_units", async () => {
      await expect(seedGoal(platformOrgId, { metric: "DEALS_WON", valueCount: 5, valueMinorUnits: 100 })).rejects.toThrow();
    });

    it("accepts a valid count-metric goal (positive control)", async () => {
      const goal = await seedGoal(platformOrgId, { metric: "CALLS_LOGGED", valueCount: 20 });
      expect(goal.valueCount).toBe(20);
    });

    it("rejects a LEAD_CONVERSION_RATE goal missing value_percent", async () => {
      await expect(seedGoal(platformOrgId, { metric: "LEAD_CONVERSION_RATE", valueCount: null, valuePercent: null })).rejects.toThrow();
    });

    it("accepts a valid LEAD_CONVERSION_RATE goal (positive control)", async () => {
      const goal = await seedGoal(platformOrgId, { metric: "LEAD_CONVERSION_RATE", valueCount: null, valuePercent: 40 });
      expect(goal.valuePercent).toBe(40);
    });

    it("rejects value_percent above 100", async () => {
      await expect(seedGoal(platformOrgId, { metric: "LEAD_CONVERSION_RATE", valueCount: null, valuePercent: 101 })).rejects.toThrow();
    });

    it("accepts value_percent of exactly 100", async () => {
      const goal = await seedGoal(platformOrgId, { metric: "LEAD_CONVERSION_RATE", valueCount: null, valuePercent: 100 });
      expect(goal.valuePercent).toBe(100);
    });

    it("rejects a negative value_count", async () => {
      await expect(seedGoal(platformOrgId, { metric: "DEALS_WON", valueCount: -1 })).rejects.toThrow();
    });

    it("rejects an inverted period (period_start >= period_end)", async () => {
      await expect(seedGoal(platformOrgId, { periodStart: new Date("2026-03-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") })).rejects.toThrow();
    });
  });

  describe("crm_sales_goals_no_overlapping_active_period (EXCLUDE USING gist)", () => {
    it("rejects two ACTIVE goals for the same rep/kind/metric with overlapping periods", async () => {
      const member = await seedMember(platformOrgId);
      await seedGoal(platformOrgId, { salesTeamMemberId: member.id, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      await expect(
        seedGoal(platformOrgId, { salesTeamMemberId: member.id, periodStart: new Date("2026-01-15T00:00:00Z"), periodEnd: new Date("2026-02-15T00:00:00Z") }),
      ).rejects.toThrow();
    });

    it("accepts two ACTIVE goals for the same rep/kind/metric with ADJACENT (non-overlapping, half-open) periods", async () => {
      const member = await seedMember(platformOrgId);
      await seedGoal(platformOrgId, { salesTeamMemberId: member.id, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      const second = await seedGoal(platformOrgId, { salesTeamMemberId: member.id, periodStart: new Date("2026-02-01T00:00:00Z"), periodEnd: new Date("2026-03-01T00:00:00Z") });
      expect(second.periodStart.getTime()).toBe(new Date("2026-02-01T00:00:00Z").getTime());
    });

    it("rejects two organization-wide (NULL sales_team_member_id) ACTIVE goals with overlapping periods — proves the COALESCE sentinel", async () => {
      await seedGoal(platformOrgId, { salesTeamMemberId: null, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      await expect(
        seedGoal(platformOrgId, { salesTeamMemberId: null, periodStart: new Date("2026-01-10T00:00:00Z"), periodEnd: new Date("2026-02-10T00:00:00Z") }),
      ).rejects.toThrow();
    });

    it("accepts two ACTIVE goals with overlapping periods but a different metric", async () => {
      const member = await seedMember(platformOrgId);
      await seedGoal(platformOrgId, { salesTeamMemberId: member.id, metric: "DEALS_WON", periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      const second = await seedGoal(platformOrgId, { salesTeamMemberId: member.id, metric: "CALLS_LOGGED", periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      expect(second.metric).toBe("CALLS_LOGGED");
    });

    it("accepts two ACTIVE goals with overlapping periods but a different kind", async () => {
      const member = await seedMember(platformOrgId);
      await seedGoal(platformOrgId, { salesTeamMemberId: member.id, kind: "TARGET", periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      const second = await seedGoal(platformOrgId, { salesTeamMemberId: member.id, kind: "QUOTA", periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      expect(second.kind).toBe("QUOTA");
    });

    it("an ARCHIVED goal does not block a new ACTIVE goal covering the exact same period", async () => {
      const member = await seedMember(platformOrgId);
      const first = await seedGoal(platformOrgId, { salesTeamMemberId: member.id, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      await withTenantContext(platformContext(), (tx) => tx.crmSalesGoal.update({ where: { id: first.id }, data: { status: "ARCHIVED" } }));
      const replacement = await seedGoal(platformOrgId, { salesTeamMemberId: member.id, periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-02-01T00:00:00Z") });
      expect(replacement.status).toBe("ACTIVE");
    });
  });
});
