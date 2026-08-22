import { addMoney } from "@/lib/utils/money";

/**
 * Tax compliance reporting (Module 16) — pure aggregation over
 * already-fetched `InvoiceLineItemTax` rows (real per-component tax
 * detail Stripe sends on every invoice line; see
 * `billing-webhook-service.ts`'s own capture and
 * `prisma/schema.prisma`'s `InvoiceLineItemTax` doc comment). This
 * module does NOT calculate tax — it reports on tax the PROVIDER
 * already calculated and charged. See `tax-compliance.md` "What this
 * does NOT claim to be" for the full boundary.
 */

export interface TaxComponent {
  amount: number;
  currency: string;
  organizationId: string;
  /** Stripe's own classification (`standard_rated`, `product_exempt`, `reverse_charge`, ...) — real, never inferred. `null` only when Stripe itself returned none. */
  taxabilityReason: string | null;
  /** Stripe's own tax rate id — an opaque reference, deliberately never resolved to a jurisdiction name (see `tax-compliance.md`). `null` only when Stripe itself returned none. */
  providerTaxRateId: string | null;
}

export interface TaxComplianceRow {
  currency: string;
  /** `"unknown"` stands in for a real `null` from the provider — never silently dropped from the report. */
  taxabilityReason: string;
  providerTaxRateId: string;
  /** Minor units — the sum of every component matching this (currency, taxabilityReason, providerTaxRateId) triple. */
  amount: number;
  componentCount: number;
}

const UNKNOWN = "unknown";

/** Grouped by (currency, taxabilityReason, providerTaxRateId) — the finest breakdown this platform can honestly produce without resolving the provider's own tax rate id (not done — see this module's own top comment). */
export function summarizeTaxCollected(components: TaxComponent[]): TaxComplianceRow[] {
  const totals = new Map<string, TaxComplianceRow>();
  for (const component of components) {
    const taxabilityReason = component.taxabilityReason ?? UNKNOWN;
    const providerTaxRateId = component.providerTaxRateId ?? UNKNOWN;
    const key = `${component.currency}:${taxabilityReason}:${providerTaxRateId}`;
    const existing = totals.get(key) ?? { currency: component.currency, taxabilityReason, providerTaxRateId, amount: 0, componentCount: 0 };
    existing.amount = addMoney({ minorUnits: existing.amount, currency: component.currency }, { minorUnits: component.amount, currency: component.currency }).minorUnits;
    existing.componentCount += 1;
    totals.set(key, existing);
  }
  return Array.from(totals.values()).sort(
    (a, b) => a.currency.localeCompare(b.currency) || a.providerTaxRateId.localeCompare(b.providerTaxRateId) || a.taxabilityReason.localeCompare(b.taxabilityReason),
  );
}

export interface TaxTotalByCurrency {
  currency: string;
  amount: number;
}

/** The single "total tax collected" headline figure per currency — never blended across currencies (same discipline as every other Module 15/16 aggregate). */
export function summarizeTaxTotalsByCurrency(components: TaxComponent[]): TaxTotalByCurrency[] {
  const totals = new Map<string, number>();
  for (const component of components) {
    totals.set(component.currency, addMoney({ minorUnits: totals.get(component.currency) ?? 0, currency: component.currency }, { minorUnits: component.amount, currency: component.currency }).minorUnits);
  }
  return Array.from(totals.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
