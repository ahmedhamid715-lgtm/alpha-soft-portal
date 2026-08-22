import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { computeCreditBalance } from "@/lib/billing/ledger";

/**
 * Module 14 spec §11/§17/§41 (adversarial #28: "Credit over-issuance")
 * — proves `@@unique([relatedEntryId])` closes the double-compensation
 * race: two simultaneous `adjustCredit()` calls against the SAME
 * original entry must never both succeed.
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

describe.skipIf(!isDatabaseConfigured)("credit concurrency (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Credit Concurrency Org A", displayName: "Credit Concurrency Org A", slug: `credit-concurrency-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeMember(organizationId: string, roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  it("two SIMULTANEOUS adjustments of the SAME original entry: exactly one compensating entry is ever recorded", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_credit_concurrency_${generateId()}` }, tx),
    );
    const original = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      creditLedgerRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, type: "CREDIT", amount: 10_000, currency: "USD", reason: "Concurrency test credit" }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_admin", "credit-adjust-concurrency-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { adjustCredit } = await import("@/server/services/credit-service");

    const results = await Promise.allSettled([
      adjustCredit({ organizationId: orgAId, entryId: original.id, reason: "Duplicate adjustment attempt A" }),
      adjustCredit({ organizationId: orgAId, entryId: original.id, reason: "Duplicate adjustment attempt B" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

    const entries = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => creditLedgerRepository.listForOrganization(orgAId, tx));
    const compensating = entries.filter((e) => e.relatedEntryId === original.id);
    expect(compensating).toHaveLength(1); // never two

    // The ledger balance reflects EXACTLY one credit + one offsetting
    // debit — net zero — never a double-reversal or a leftover
    // mismatch.
    expect(computeCreditBalance(entries)).toBe(0);
  });

  it("issuing two DIFFERENT credits concurrently is always safe — no shared mutable state to race over", async () => {
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_credit_issue_concurrency_${generateId()}` }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_admin", "credit-issue-concurrency-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueCredit } = await import("@/server/services/credit-service");

    const results = await Promise.allSettled([
      issueCredit({ organizationId: orgAId, amount: 1_000, currency: "USD", reason: "Concurrent credit A" }),
      issueCredit({ organizationId: orgAId, amount: 2_000, currency: "USD", reason: "Concurrent credit B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);

    const entries = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => creditLedgerRepository.listForOrganization(orgAId, tx));
    expect(computeCreditBalance(entries)).toBe(3_000);
  });
});
