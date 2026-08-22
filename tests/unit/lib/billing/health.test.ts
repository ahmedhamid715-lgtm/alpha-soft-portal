import { describe, expect, it } from "vitest";
import { computeBillingHealth } from "@/lib/billing/health";

describe("computeBillingHealth", () => {
  it("no billing account status and no subscription → no_subscription", () => {
    expect(computeBillingHealth(null, null)).toBe("no_subscription");
  });

  it("a SUSPENDED billing account always wins, regardless of subscription status", () => {
    expect(computeBillingHealth("SUSPENDED", { status: "ACTIVE", cancelAtPeriodEnd: false })).toBe("suspended");
    expect(computeBillingHealth("SUSPENDED", null)).toBe("suspended");
  });

  it("a CLOSED billing account always reports canceled", () => {
    expect(computeBillingHealth("CLOSED", { status: "ACTIVE", cancelAtPeriodEnd: false })).toBe("canceled");
  });

  it("ACTIVE subscription (billing account ACTIVE) → healthy", () => {
    expect(computeBillingHealth("ACTIVE", { status: "ACTIVE", cancelAtPeriodEnd: false })).toBe("healthy");
  });

  it("ACTIVE subscription scheduled to cancel is still healthy — the customer is fully served until the period ends", () => {
    expect(computeBillingHealth("ACTIVE", { status: "ACTIVE", cancelAtPeriodEnd: true })).toBe("healthy");
  });

  it("TRIALING → trial", () => {
    expect(computeBillingHealth("ACTIVE", { status: "TRIALING", cancelAtPeriodEnd: false })).toBe("trial");
  });

  it("PAST_DUE → past_due", () => {
    expect(computeBillingHealth("ACTIVE", { status: "PAST_DUE", cancelAtPeriodEnd: false })).toBe("past_due");
  });

  it("UNPAID → payment_failed", () => {
    expect(computeBillingHealth("ACTIVE", { status: "UNPAID", cancelAtPeriodEnd: false })).toBe("payment_failed");
  });

  it("INCOMPLETE (first payment never completed) → payment_due", () => {
    expect(computeBillingHealth("ACTIVE", { status: "INCOMPLETE", cancelAtPeriodEnd: false })).toBe("payment_due");
  });

  it("CANCELED / INCOMPLETE_EXPIRED → canceled", () => {
    expect(computeBillingHealth("ACTIVE", { status: "CANCELED", cancelAtPeriodEnd: false })).toBe("canceled");
    expect(computeBillingHealth("ACTIVE", { status: "INCOMPLETE_EXPIRED", cancelAtPeriodEnd: false })).toBe("canceled");
  });

  it("PAUSED → suspended", () => {
    expect(computeBillingHealth("ACTIVE", { status: "PAUSED", cancelAtPeriodEnd: false })).toBe("suspended");
  });
});
