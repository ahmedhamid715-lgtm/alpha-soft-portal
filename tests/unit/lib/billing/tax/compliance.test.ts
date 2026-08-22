import { describe, expect, it } from "vitest";
import { summarizeTaxCollected, summarizeTaxTotalsByCurrency, type TaxComponent } from "@/lib/billing/tax/compliance";

describe("summarizeTaxCollected", () => {
  it("groups by (currency, taxabilityReason, providerTaxRateId), summing amounts within each group", () => {
    const components: TaxComponent[] = [
      { amount: 700, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_ca_state" },
      { amount: 150, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_ca_state" },
      { amount: 65, currency: "USD", organizationId: "o2", taxabilityReason: "standard_rated", providerTaxRateId: "txr_ca_county" },
    ];
    const result = summarizeTaxCollected(components);
    expect(result).toHaveLength(2);
    const stateRow = result.find((r) => r.providerTaxRateId === "txr_ca_state")!;
    expect(stateRow).toMatchObject({ currency: "USD", taxabilityReason: "standard_rated", amount: 850, componentCount: 2 });
    const countyRow = result.find((r) => r.providerTaxRateId === "txr_ca_county")!;
    expect(countyRow).toMatchObject({ amount: 65, componentCount: 1 });
  });

  it("never blends two different currencies into one row, even with identical taxabilityReason/providerTaxRateId", () => {
    const components: TaxComponent[] = [
      { amount: 700, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_x" },
      { amount: 500, currency: "EUR", organizationId: "o2", taxabilityReason: "standard_rated", providerTaxRateId: "txr_x" },
    ];
    const result = summarizeTaxCollected(components);
    expect(result).toHaveLength(2);
  });

  it("a null taxabilityReason/providerTaxRateId is grouped under the literal string 'unknown', never dropped from the report", () => {
    const components: TaxComponent[] = [{ amount: 300, currency: "USD", organizationId: "o1", taxabilityReason: null, providerTaxRateId: null }];
    const result = summarizeTaxCollected(components);
    expect(result).toEqual([{ currency: "USD", taxabilityReason: "unknown", providerTaxRateId: "unknown", amount: 300, componentCount: 1 }]);
  });

  it("a null providerTaxRateId with a real taxabilityReason is grouped separately from a real providerTaxRateId with the same reason", () => {
    const components: TaxComponent[] = [
      { amount: 100, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: null },
      { amount: 200, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_x" },
    ];
    const result = summarizeTaxCollected(components);
    expect(result).toHaveLength(2);
  });

  it("an empty component list returns an empty array, not a zero-row placeholder", () => {
    expect(summarizeTaxCollected([])).toEqual([]);
  });

  it("sorts deterministically by currency, then providerTaxRateId, then taxabilityReason", () => {
    const components: TaxComponent[] = [
      { amount: 100, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_z" },
      { amount: 100, currency: "EUR", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_a" },
      { amount: 100, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_a" },
    ];
    const result = summarizeTaxCollected(components);
    expect(result.map((r) => `${r.currency}:${r.providerTaxRateId}`)).toEqual(["EUR:txr_a", "USD:txr_a", "USD:txr_z"]);
  });
});

describe("summarizeTaxTotalsByCurrency", () => {
  it("sums every component's amount per currency, ignoring taxabilityReason/providerTaxRateId entirely", () => {
    const components: TaxComponent[] = [
      { amount: 700, currency: "USD", organizationId: "o1", taxabilityReason: "standard_rated", providerTaxRateId: "txr_state" },
      { amount: 150, currency: "USD", organizationId: "o1", taxabilityReason: "reverse_charge", providerTaxRateId: "txr_county" },
      { amount: 500, currency: "EUR", organizationId: "o2", taxabilityReason: "standard_rated", providerTaxRateId: "txr_eu" },
    ];
    const result = summarizeTaxTotalsByCurrency(components);
    expect(result).toEqual([
      { currency: "EUR", amount: 500 },
      { currency: "USD", amount: 850 },
    ]);
  });

  it("an empty list returns an empty array", () => {
    expect(summarizeTaxTotalsByCurrency([])).toEqual([]);
  });
});
