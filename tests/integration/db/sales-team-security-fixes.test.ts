import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * Regression coverage for the findings from Build 21's own security
 * review (performed directly by Claude after three consecutive Codex
 * dispatch interruptions — see the Build 21 completion report for the
 * full account; see `db/errors.ts`'s own `23P01` case comment and
 * `crm-sales-goal-service.ts`'s own `createGoalSchema` comment for what
 * each fix actually does). Same `vi.mock("@/lib/auth/session-guard")` +
 * real-DB pattern `sales-pipeline-security-fixes.test.ts` (Build 20)
 * already establishes.
 */
let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("Sales Team application-layer security fixes (database integration)", () => {
  const userIds: string[] = [];
  const goalIds: string[] = [];
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
    platformOrgId = (await organizationRepository.findPlatformOrganization())!.id;
  });

  afterEach(async () => {
    if (goalIds.length) await db.crmSalesGoal.deleteMany({ where: { id: { in: goalIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    goalIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makePlatformAdmin(email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey.platform_admin;
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId, role: "platform_admin" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "platform_admin", roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  describe("overlapping-goal race produces a clean ConflictError, not a generic DatabaseError (Finding 1 — LOW)", () => {
    it("the losing side of two concurrent createGoal() calls for the same overlapping period gets a real ConflictError", async () => {
      const admin = await makePlatformAdmin("sales-team-fix-admin1@example.com");
      actAs(admin.userId, admin.membership);

      const { createGoal } = await import("@/server/services/crm-sales-goal-service");
      const input = { kind: "TARGET" as const, metric: "DEALS_WON" as const, valueCount: 5, periodStart: "2026-05-01T00:00:00Z", periodEnd: "2026-06-01T00:00:00Z" };

      // Two genuinely concurrent calls — both pass the app-layer
      // pre-check (findOverlapping()) before either has committed its
      // own INSERT, so the database's own EXCLUDE constraint is the
      // real arbiter of which one wins.
      const results = await Promise.allSettled([createGoal(input), createGoal(input)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      if (fulfilled[0]?.status === "fulfilled") goalIds.push(fulfilled[0].value.id);

      const rejection = rejected[0];
      expect(rejection?.status).toBe("rejected");
      if (rejection?.status === "rejected") {
        // Before the fix, this surfaced as a generic DatabaseError ("A
        // database error occurred") — live-verified that a genuinely
        // concurrent race for the same GIST exclusion constraint
        // surfaces as Postgres `deadlock_detected` (40P01), not the
        // simpler ordered `exclusion_violation` (23P01) a sequential
        // "insert, then insert again" test would produce — see
        // `db/errors.ts`'s own comment on why both map to ConflictError.
        expect(rejection.reason).toMatchObject({ code: "CONFLICT" });
      }
    });
  });

  describe("malformed custom goal period fails cleanly, not as an unhandled RangeError (Finding 2 — LOW)", () => {
    it("rejects periodStart >= periodEnd with a real ValidationError", async () => {
      const admin = await makePlatformAdmin("sales-team-fix-admin2@example.com");
      actAs(admin.userId, admin.membership);

      const { createGoal } = await import("@/server/services/crm-sales-goal-service");
      // Only reachable via a direct/forged call — the real UI
      // (`NewGoalForm`) only ever sends a named `period`, never a raw
      // `periodStart`/`periodEnd` pair.
      await expect(
        createGoal({
          kind: "TARGET",
          metric: "DEALS_WON",
          valueCount: 5,
          periodStart: "2026-06-01T00:00:00Z",
          periodEnd: "2026-01-01T00:00:00Z",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("accepts a valid custom periodStart < periodEnd (positive control)", async () => {
      const admin = await makePlatformAdmin("sales-team-fix-admin3@example.com");
      actAs(admin.userId, admin.membership);

      const { createGoal } = await import("@/server/services/crm-sales-goal-service");
      const goal = await createGoal({
        kind: "TARGET",
        metric: "DEALS_WON",
        valueCount: 5,
        periodStart: "2026-07-01T00:00:00Z",
        periodEnd: "2026-08-01T00:00:00Z",
      });
      goalIds.push(goal.id);
      expect(goal.periodLabel).toBe("custom");
    });
  });
});
