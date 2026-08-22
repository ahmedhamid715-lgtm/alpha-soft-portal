import { describe, expect, it } from "vitest";
import { monthlyEquivalent, computeMrrByCurrency, computeArr, MRR_INCLUDED_STATUSES, type SubscriptionForMrr } from "@/lib/billing/reporting/mrr";

describe("monthlyEquivalent", () => {
  it("a MONTH-interval item is its own unit amount times quantity", () => {
    expect(monthlyEquivalent({ planPriceUnitAmount: 4900, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 })).toBe(4900);
    expect(monthlyEquivalent({ planPriceUnitAmount: 4900, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 3 })).toBe(14700);
  });

  it("a YEAR-interval item divides by 12, rounding to the nearest minor unit", () => {
    // 199000 / 12 = 16583.33... -> rounds to 16583
    expect(monthlyEquivalent({ planPriceUnitAmount: 199000, planPriceInterval: "YEAR", planPriceCurrency: "USD", quantity: 1 })).toBe(16583);
  });

  it("rounds up when the remainder is >= 0.5", () => {
    // 100006 / 12 = 8333.833... -> rounds to 8334
    expect(monthlyEquivalent({ planPriceUnitAmount: 100006, planPriceInterval: "YEAR", planPriceCurrency: "USD", quantity: 1 })).toBe(8334);
  });

  it("quantity multiplies AFTER the per-unit yearly division — adding a second identical item doubles its own contribution exactly", () => {
    const one = monthlyEquivalent({ planPriceUnitAmount: 199000, planPriceInterval: "YEAR", planPriceCurrency: "USD", quantity: 1 });
    const two = monthlyEquivalent({ planPriceUnitAmount: 199000, planPriceInterval: "YEAR", planPriceCurrency: "USD", quantity: 2 });
    expect(two).toBe(one * 2);
  });

  it("a zero-value (free) price contributes zero", () => {
    expect(monthlyEquivalent({ planPriceUnitAmount: 0, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 })).toBe(0);
  });
});

function sub(overrides: Partial<SubscriptionForMrr> & { items: SubscriptionForMrr["items"] }): SubscriptionForMrr {
  return { subscriptionId: "sub_1", organizationId: "org_1", status: "ACTIVE", ...overrides };
}

describe("computeMrrByCurrency", () => {
  it("sums a single ACTIVE subscription's items", () => {
    const result = computeMrrByCurrency([
      sub({ items: [{ planPriceUnitAmount: 19900, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
    ]);
    expect(result).toEqual([{ currency: "USD", mrr: 19900, arr: 19900 * 12, subscriptionCount: 1 }]);
  });

  it("TRIALING subscriptions are EXCLUDED from MRR", () => {
    const result = computeMrrByCurrency([
      sub({ status: "TRIALING", items: [{ planPriceUnitAmount: 19900, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
    ]);
    expect(result).toEqual([]);
  });

  it("PAUSED, CANCELED, INCOMPLETE, INCOMPLETE_EXPIRED, and UNPAID subscriptions are all EXCLUDED", () => {
    const excludedStatuses: SubscriptionForMrr["status"][] = ["PAUSED", "CANCELED", "INCOMPLETE", "INCOMPLETE_EXPIRED", "UNPAID"];
    for (const status of excludedStatuses) {
      const result = computeMrrByCurrency([sub({ status, items: [{ planPriceUnitAmount: 19900, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] })]);
      expect(result, `status ${status} should be excluded`).toEqual([]);
    }
  });

  it("PAST_DUE subscriptions ARE included — still contractually active", () => {
    const result = computeMrrByCurrency([
      sub({ status: "PAST_DUE", items: [{ planPriceUnitAmount: 19900, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
    ]);
    expect(result[0]?.mrr).toBe(19900);
  });

  it("MRR_INCLUDED_STATUSES is exactly {ACTIVE, PAST_DUE} — documented and pinned", () => {
    expect([...MRR_INCLUDED_STATUSES].sort()).toEqual(["ACTIVE", "PAST_DUE"]);
  });

  it("sums multiple subscription items on the SAME subscription", () => {
    const result = computeMrrByCurrency([
      sub({
        items: [
          { planPriceUnitAmount: 5000, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 },
          { planPriceUnitAmount: 1000, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 2 },
        ],
      }),
    ]);
    expect(result[0]?.mrr).toBe(5000 + 2000);
  });

  it("groups by currency — never sums USD and EUR together", () => {
    const result = computeMrrByCurrency([
      sub({ subscriptionId: "sub_usd", items: [{ planPriceUnitAmount: 10000, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
      sub({ subscriptionId: "sub_eur", items: [{ planPriceUnitAmount: 9000, planPriceInterval: "MONTH", planPriceCurrency: "EUR", quantity: 1 }] }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.currency === "USD")?.mrr).toBe(10000);
    expect(result.find((r) => r.currency === "EUR")?.mrr).toBe(9000);
  });

  it("sums across multiple ACTIVE subscriptions for the same currency", () => {
    const result = computeMrrByCurrency([
      sub({ subscriptionId: "s1", items: [{ planPriceUnitAmount: 5000, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
      sub({ subscriptionId: "s2", items: [{ planPriceUnitAmount: 7500, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
    ]);
    expect(result[0]?.mrr).toBe(12500);
    expect(result[0]?.subscriptionCount).toBe(2);
  });

  it("a subscription with zero items contributes nothing and is not counted", () => {
    const result = computeMrrByCurrency([sub({ items: [] })]);
    expect(result).toEqual([]);
  });

  it("an empty subscription list returns an empty array, not a fabricated zero row", () => {
    expect(computeMrrByCurrency([])).toEqual([]);
  });

  it("result is sorted deterministically by currency code", () => {
    const result = computeMrrByCurrency([
      sub({ subscriptionId: "s_usd", items: [{ planPriceUnitAmount: 100, planPriceInterval: "MONTH", planPriceCurrency: "USD", quantity: 1 }] }),
      sub({ subscriptionId: "s_aud", items: [{ planPriceUnitAmount: 100, planPriceInterval: "MONTH", planPriceCurrency: "AUD", quantity: 1 }] }),
      sub({ subscriptionId: "s_eur", items: [{ planPriceUnitAmount: 100, planPriceInterval: "MONTH", planPriceCurrency: "EUR", quantity: 1 }] }),
    ]);
    expect(result.map((r) => r.currency)).toEqual(["AUD", "EUR", "USD"]);
  });
});

describe("computeArr", () => {
  it("is exactly MRR times 12", () => {
    expect(computeArr(19900)).toBe(19900 * 12);
    expect(computeArr(0)).toBe(0);
  });
});
