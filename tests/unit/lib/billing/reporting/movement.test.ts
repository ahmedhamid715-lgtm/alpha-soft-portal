import { describe, expect, it } from "vitest";
import {
  classifyNewAndReactivation,
  classifyChurn,
  classifyExpansionAndContraction,
  summarizeMovements,
  type SubscriptionLifecycleFact,
  type PlanChangeFact,
} from "@/lib/billing/reporting/movement";

const periodStart = new Date("2026-08-01T00:00:00Z");
const periodEnd = new Date("2026-09-01T00:00:00Z");

function fact(overrides: Partial<SubscriptionLifecycleFact>): SubscriptionLifecycleFact {
  return {
    subscriptionId: "sub_1",
    organizationId: "org_1",
    createdAt: new Date("2026-08-15T00:00:00Z"),
    canceledAt: null,
    status: "ACTIVE",
    currency: "USD",
    currentMonthlyEquivalent: 10000,
    ...overrides,
  };
}

describe("classifyNewAndReactivation", () => {
  it("a subscription created within the period, with no earlier churned subscription, is NEW", () => {
    const subscription = fact({});
    const movements = classifyNewAndReactivation([subscription], periodStart, periodEnd, new Map([["org_1", [subscription]]]));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "NEW", previousMrr: null, currentMrr: 10000, delta: 10000 });
  });

  it("a subscription created within the period, where the SAME org has an earlier subscription canceled before this one started, is REACTIVATION", () => {
    const churned = fact({ subscriptionId: "sub_old", canceledAt: new Date("2026-07-01T00:00:00Z"), status: "CANCELED" });
    const reactivated = fact({ subscriptionId: "sub_new", createdAt: new Date("2026-08-15T00:00:00Z") });
    const movements = classifyNewAndReactivation([reactivated], periodStart, periodEnd, new Map([["org_1", [churned, reactivated]]]));
    expect(movements[0]?.type).toBe("REACTIVATION");
  });

  it("a subscription created OUTSIDE the period is not classified at all", () => {
    const subscription = fact({ createdAt: new Date("2026-07-15T00:00:00Z") });
    const movements = classifyNewAndReactivation([subscription], periodStart, periodEnd, new Map([["org_1", [subscription]]]));
    expect(movements).toEqual([]);
  });

  it("period start is inclusive, period end is exclusive", () => {
    const atStart = fact({ createdAt: periodStart });
    const atEnd = fact({ createdAt: periodEnd });
    expect(classifyNewAndReactivation([atStart], periodStart, periodEnd, new Map())).toHaveLength(1);
    expect(classifyNewAndReactivation([atEnd], periodStart, periodEnd, new Map())).toHaveLength(0);
  });

  it("a churned subscription belonging to a DIFFERENT organization does not make this one a reactivation", () => {
    const otherOrgChurned = fact({ subscriptionId: "sub_other_org", organizationId: "org_2", canceledAt: new Date("2026-07-01T00:00:00Z"), status: "CANCELED" });
    const subscription = fact({});
    const movements = classifyNewAndReactivation([subscription], periodStart, periodEnd, new Map([["org_1", [subscription]], ["org_2", [otherOrgChurned]]]));
    expect(movements[0]?.type).toBe("NEW");
  });
});

describe("classifyChurn", () => {
  it("a CANCELED subscription with canceledAt inside the period is CHURN, valued at its current (frozen) monthly equivalent", () => {
    const subscription = fact({ status: "CANCELED", canceledAt: new Date("2026-08-20T00:00:00Z"), currentMonthlyEquivalent: 5000 });
    const movements = classifyChurn([subscription], periodStart, periodEnd);
    expect(movements[0]).toMatchObject({ type: "CHURN", previousMrr: 5000, currentMrr: null, delta: -5000 });
  });

  it("a subscription that is NOT CANCELED is never classified as churn even if canceledAt happens to be set", () => {
    const subscription = fact({ status: "ACTIVE", canceledAt: new Date("2026-08-20T00:00:00Z") });
    expect(classifyChurn([subscription], periodStart, periodEnd)).toEqual([]);
  });

  it("a canceledAt outside the period is not classified", () => {
    const subscription = fact({ status: "CANCELED", canceledAt: new Date("2026-06-01T00:00:00Z") });
    expect(classifyChurn([subscription], periodStart, periodEnd)).toEqual([]);
  });
});

describe("classifyExpansionAndContraction", () => {
  function change(overrides: Partial<PlanChangeFact>): PlanChangeFact {
    return { organizationId: "org_1", subscriptionId: "sub_1", occurredAt: new Date("2026-08-10T00:00:00Z"), previousMonthlyEquivalent: 5000, newMonthlyEquivalent: 10000, currency: "USD", ...overrides };
  }

  it("a higher new price is EXPANSION with a positive delta", () => {
    const movements = classifyExpansionAndContraction([change({})]);
    expect(movements[0]).toMatchObject({ type: "EXPANSION", previousMrr: 5000, currentMrr: 10000, delta: 5000 });
  });

  it("a lower new price is CONTRACTION with a negative delta", () => {
    const movements = classifyExpansionAndContraction([change({ previousMonthlyEquivalent: 10000, newMonthlyEquivalent: 4000 })]);
    expect(movements[0]).toMatchObject({ type: "CONTRACTION", delta: -6000 });
  });

  it("an equal-value change (a lateral move) produces NO movement at all — never a fabricated zero-delta row", () => {
    const movements = classifyExpansionAndContraction([change({ previousMonthlyEquivalent: 5000, newMonthlyEquivalent: 5000 })]);
    expect(movements).toEqual([]);
  });
});

describe("summarizeMovements", () => {
  it("aggregates each movement type into its own tile, plus a net change, per currency", () => {
    const summary = summarizeMovements([
      { organizationId: "o1", subscriptionId: "s1", type: "NEW", previousMrr: null, currentMrr: 10000, delta: 10000, currency: "USD", effectiveDate: new Date() },
      { organizationId: "o2", subscriptionId: "s2", type: "EXPANSION", previousMrr: 5000, currentMrr: 8000, delta: 3000, currency: "USD", effectiveDate: new Date() },
      { organizationId: "o3", subscriptionId: "s3", type: "CONTRACTION", previousMrr: 8000, currentMrr: 5000, delta: -3000, currency: "USD", effectiveDate: new Date() },
      { organizationId: "o4", subscriptionId: "s4", type: "CHURN", previousMrr: 4000, currentMrr: null, delta: -4000, currency: "USD", effectiveDate: new Date() },
      { organizationId: "o5", subscriptionId: "s5", type: "REACTIVATION", previousMrr: null, currentMrr: 2000, delta: 2000, currency: "USD", effectiveDate: new Date() },
    ]);
    expect(summary).toEqual([{ currency: "USD", newMrr: 10000, expansionMrr: 3000, contractionMrr: -3000, churnedMrr: -4000, reactivationMrr: 2000, netChange: 8000 }]);
  });

  it("groups by currency independently", () => {
    const summary = summarizeMovements([
      { organizationId: "o1", subscriptionId: "s1", type: "NEW", previousMrr: null, currentMrr: 1000, delta: 1000, currency: "USD", effectiveDate: new Date() },
      { organizationId: "o2", subscriptionId: "s2", type: "NEW", previousMrr: null, currentMrr: 900, delta: 900, currency: "EUR", effectiveDate: new Date() },
    ]);
    expect(summary).toHaveLength(2);
  });

  it("an empty movement list summarizes to an empty array", () => {
    expect(summarizeMovements([])).toEqual([]);
  });
});
