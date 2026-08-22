import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { summarizeTaxCollected, summarizeTaxTotalsByCurrency, type TaxComplianceRow, type TaxTotalByCurrency } from "@/lib/billing/tax/compliance";
import { resolvePeriod, customPeriod, PERIOD_NAMES, type FinancialPeriod, type PeriodName } from "@/lib/billing/reporting/period";

/**
 * Tax compliance reporting (Module 16) — `billing.compliance.read`,
 * PLATFORM-ONLY (same reasoning as `revenue-recognition-service.ts`).
 * Reports on tax the PROVIDER already calculated and charged
 * (`InvoiceLineItemTax`, captured since Module 16) — this module
 * calculates NOTHING; see `tax-compliance.md` "What this does NOT
 * claim to be."
 */

const periodInputSchema = z.union([z.object({ period: z.enum(PERIOD_NAMES) }), z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() })]);

function resolveRequestedPeriod(input: z.infer<typeof periodInputSchema>): FinancialPeriod {
  if ("period" in input) return resolvePeriod(input.period as PeriodName, "UTC", new Date());
  return customPeriod(input.periodStart, input.periodEnd, "UTC");
}

export interface TaxComplianceReport {
  period: FinancialPeriod;
  totalsByCurrency: TaxTotalByCurrency[];
  breakdown: TaxComplianceRow[];
}

/**
 * `billing.compliance.read` — tax collected for invoices ISSUED within
 * the requested period, broken down by currency, Stripe's own
 * taxability classification, and Stripe's own (unresolved — see
 * `tax-compliance.md`) tax rate reference id.
 */
export async function getPlatformTaxComplianceReport(rawInput: unknown): Promise<TaxComplianceReport> {
  await requirePermission("billing.compliance.read");
  const input = parseOrThrow(periodInputSchema, rawInput);
  const period = resolveRequestedPeriod(input);

  const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => invoiceRepository.listLineItemTaxesForPeriod({ platform: true }, period, tx));

  return { period, totalsByCurrency: summarizeTaxTotalsByCurrency(rows), breakdown: summarizeTaxCollected(rows) };
}
