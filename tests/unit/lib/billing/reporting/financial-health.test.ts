import { describe, expect, it } from "vitest";
import { computeFinancialHealth, type FinancialHealthSignals } from "@/lib/billing/reporting/financial-health";

function signals(overrides: Partial<FinancialHealthSignals> = {}): FinancialHealthSignals {
  return {
    billingAccountStatus: "ACTIVE",
    subscriptionStatus: "ACTIVE",
    cancelAtPeriodEnd: false,
    maxDaysOverdue: 0,
    mostOverdueInvoiceNumber: null,
    failedPaymentsLast30Days: 0,
    currency: "USD",
    ...overrides,
  };
}

describe("computeFinancialHealth", () => {
  it("a clean account with no signals at all is HEALTHY", () => {
    const result = computeFinancialHealth(signals());
    expect(result.classification).toBe("HEALTHY");
    expect(result.reasons.length).toBeGreaterThan(0); // always explains itself, even when healthy
  });

  it("a SUSPENDED billing account is CRITICAL, regardless of everything else", () => {
    const result = computeFinancialHealth(signals({ billingAccountStatus: "SUSPENDED" }));
    expect(result.classification).toBe("CRITICAL");
    expect(result.reasons.some((r) => /suspended/i.test(r))).toBe(true);
  });

  it("an UNPAID subscription is CRITICAL", () => {
    const result = computeFinancialHealth(signals({ subscriptionStatus: "UNPAID" }));
    expect(result.classification).toBe("CRITICAL");
  });

  it("60+ days overdue is CRITICAL, and the reason names the specific invoice and day count", () => {
    const result = computeFinancialHealth(signals({ maxDaysOverdue: 61, mostOverdueInvoiceNumber: "INV-2026-000042" }));
    expect(result.classification).toBe("CRITICAL");
    expect(result.reasons).toContain("Invoice INV-2026-000042 is 61 days overdue.");
  });

  it("30-59 days overdue is AT_RISK, not CRITICAL", () => {
    const result = computeFinancialHealth(signals({ maxDaysOverdue: 31, mostOverdueInvoiceNumber: "INV-1" }));
    expect(result.classification).toBe("AT_RISK");
  });

  it("2+ failed payments in 30 days is AT_RISK", () => {
    const result = computeFinancialHealth(signals({ failedPaymentsLast30Days: 2 }));
    expect(result.classification).toBe("AT_RISK");
    expect(result.reasons).toContain("2 payments failed in the last 30 days.");
  });

  it("PAST_DUE subscription status alone is AT_RISK", () => {
    const result = computeFinancialHealth(signals({ subscriptionStatus: "PAST_DUE" }));
    expect(result.classification).toBe("AT_RISK");
  });

  it("a scheduled cancellation alone is WATCH, not AT_RISK", () => {
    const result = computeFinancialHealth(signals({ cancelAtPeriodEnd: true }));
    expect(result.classification).toBe("WATCH");
    expect(result.reasons).toContain("Subscription is scheduled to cancel at the end of the current period.");
  });

  it("1-29 days overdue is WATCH", () => {
    const result = computeFinancialHealth(signals({ maxDaysOverdue: 5, mostOverdueInvoiceNumber: "INV-2" }));
    expect(result.classification).toBe("WATCH");
    expect(result.reasons).toContain("Invoice INV-2 is 5 days overdue.");
  });

  it("exactly 1 day overdue uses singular 'day', not 'days'", () => {
    const result = computeFinancialHealth(signals({ maxDaysOverdue: 1, mostOverdueInvoiceNumber: "INV-3" }));
    expect(result.reasons).toContain("Invoice INV-3 is 1 day overdue.");
  });

  it("exactly 1 failed payment is WATCH", () => {
    const result = computeFinancialHealth(signals({ failedPaymentsLast30Days: 1 }));
    expect(result.classification).toBe("WATCH");
  });

  it("CRITICAL beats AT_RISK beats WATCH when multiple signals fire at once — only the most severe tier's reasons are returned", () => {
    const result = computeFinancialHealth(signals({ billingAccountStatus: "SUSPENDED", cancelAtPeriodEnd: true, failedPaymentsLast30Days: 1 }));
    expect(result.classification).toBe("CRITICAL");
    expect(result.reasons.some((r) => /scheduled to cancel/.test(r))).toBe(false); // WATCH-tier reason never leaks into a CRITICAL result
  });

  it("a missing invoice number still produces a readable reason (no literal 'undefined')", () => {
    const result = computeFinancialHealth(signals({ maxDaysOverdue: 10, mostOverdueInvoiceNumber: null }));
    expect(result.reasons[0]).not.toMatch(/undefined|null/);
    expect(result.reasons[0]).toBe("An invoice is 10 days overdue.");
  });
});
