import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { computeAgingReport, type AgingReport } from "@/lib/billing/reporting/aging";
import { addMoney } from "@/lib/utils/money";
import { resolvePeriod, customPeriod, PERIOD_NAMES, type FinancialPeriod, type PeriodName } from "@/lib/billing/reporting/period";
import { appConfig } from "@/config/app";
import { db } from "@/lib/db/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Billed / collected / receivables / credits reporting (spec §5/§6) —
 * clearly separated financial reporting, deriving from authoritative
 * billing records only. None of these figures is "revenue" in a GAAP
 * sense — see `revenue-metrics.md` "What this platform does NOT claim
 * to be":
 *
 *   - BILLED — what was invoiced (`Invoice.subtotal`/`total`), regardless
 *     of whether it was ever collected.
 *   - COLLECTED — real cash that actually arrived (SUCCEEDED `Payment`
 *     rows), regardless of which invoice (if any) it's linked to.
 *   - REFUNDED — cash given back.
 *   - CREDITS ISSUED — a promise applied to a FUTURE invoice, not cash
 *     movement at all (see `mrr.ts`'s own reasoning for why credits
 *     never reduce MRR either).
 *   - OUTSTANDING / AR AGING — what's billed but not yet collected,
 *     bucketed by how overdue it is.
 */

const periodInputSchema = z.union([z.object({ period: z.enum(PERIOD_NAMES) }), z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() })]);

function resolveRequestedPeriod(input: z.infer<typeof periodInputSchema>, timeZone: string, now: Date): FinancialPeriod {
  if ("period" in input) return resolvePeriod(input.period as PeriodName, timeZone, now);
  return customPeriod(input.periodStart, input.periodEnd, timeZone);
}

async function resolveTimeZoneForOrganization(organizationId: string): Promise<string> {
  const organization = await organizationRepository.findById(organizationId);
  return organization?.timezone ?? appConfig.defaults.timezone;
}

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface RevenueReport {
  period: FinancialPeriod;
  billed: { currency: string; subtotal: number; total: number; invoiceCount: number }[];
  collected: { currency: string; amount: number; paymentCount: number }[];
  refunded: { currency: string; amount: number; refundCount: number }[];
  creditsIssued: { currency: string; amount: number; entryCount: number }[];
  /** `collected - refunded` per currency present in EITHER — an honest "net cash movement" figure, still not a GAAP net-revenue figure. */
  netCollected: CurrencyAmount[];
}

async function buildRevenueReport(scope: { organizationId: string } | { platform: true }, period: FinancialPeriod, tx: TransactionClient | typeof db): Promise<RevenueReport> {
  const [billedRows, collectedRows, refundRows, creditRows] = await Promise.all([
    invoiceRepository.sumBilledByCurrency(scope, period, tx),
    paymentRepository.sumCollectedByCurrency(scope, period, tx),
    refundRepository.listSucceededInPeriod(scope, period, tx),
    creditLedgerRepository.sumIssuedByCurrency(scope, period, tx),
  ]);

  const refundedByCurrency = new Map<string, { amount: number; count: number }>();
  for (const refund of refundRows) {
    const currency = refund.payment.currency;
    const existing = refundedByCurrency.get(currency) ?? { amount: 0, count: 0 };
    existing.amount = addMoney({ minorUnits: existing.amount, currency }, { minorUnits: refund.amount, currency }).minorUnits;
    existing.count += 1;
    refundedByCurrency.set(currency, existing);
  }
  const refunded = Array.from(refundedByCurrency.entries())
    .map(([currency, { amount, count }]) => ({ currency, amount, refundCount: count }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const netByCurrency = new Map<string, number>();
  for (const row of collectedRows) netByCurrency.set(row.currency, (netByCurrency.get(row.currency) ?? 0) + row.amount);
  for (const row of refunded) netByCurrency.set(row.currency, (netByCurrency.get(row.currency) ?? 0) - row.amount);
  const netCollected = Array.from(netByCurrency.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    period,
    billed: billedRows.map((r) => ({ currency: r.currency, subtotal: r.subtotal, total: r.total, invoiceCount: r.invoiceCount })).sort((a, b) => a.currency.localeCompare(b.currency)),
    collected: [...collectedRows].sort((a, b) => a.currency.localeCompare(b.currency)),
    refunded,
    creditsIssued: [...creditRows].sort((a, b) => a.currency.localeCompare(b.currency)),
    netCollected,
  };
}

/** `billing.analytics.read` — platform-wide billed/collected/refunded/credits for a period. */
export async function getPlatformRevenueReport(rawInput: unknown): Promise<RevenueReport> {
  await requirePermission("billing.analytics.read");
  const input = parseOrThrow(periodInputSchema, rawInput);
  const period = resolveRequestedPeriod(input, "UTC", new Date());
  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => buildRevenueReport({ platform: true }, period, tx));
}

const orgPeriodInputSchema = z.object({ organizationId: z.string().uuid(), period: z.enum(PERIOD_NAMES).optional(), periodStart: z.coerce.date().optional(), periodEnd: z.coerce.date().optional() });

/** `billing.read` (ORGANIZATION) — this organization's own billed/collected/refunded/credits for a period. */
export async function getOrganizationRevenueReport(rawInput: unknown): Promise<RevenueReport> {
  const input = parseOrThrow(orgPeriodInputSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  const timeZone = await resolveTimeZoneForOrganization(input.organizationId);
  const period = input.period
    ? resolvePeriod(input.period, timeZone, new Date())
    : input.periodStart && input.periodEnd
      ? customPeriod(input.periodStart, input.periodEnd, timeZone)
      : resolvePeriod("current_month", timeZone, new Date());

  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    buildRevenueReport({ organizationId: input.organizationId }, period, tx),
  );
}

/** `billing.analytics.read` — platform-wide AR aging, as of now. */
export async function getPlatformAgingReport(): Promise<AgingReport> {
  await requirePermission("billing.analytics.read");
  const invoices = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => invoiceRepository.listOpenForAging({ platform: true }, tx));
  return computeAgingReport(invoices.map((i) => ({ invoiceId: i.id, organizationId: i.organizationId, currency: i.currency, amountDue: i.amountDue, dueDate: i.dueDate })), new Date());
}

/** `billing.read` (ORGANIZATION) — this organization's own AR aging. */
export async function getOrganizationAgingReport(rawInput: unknown): Promise<AgingReport> {
  const input = parseOrThrow(z.object({ organizationId: z.string().uuid() }), rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  const invoices = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    invoiceRepository.listOpenForAging({ organizationId: input.organizationId }, tx),
  );
  return computeAgingReport(invoices.map((i) => ({ invoiceId: i.id, organizationId: i.organizationId, currency: i.currency, amountDue: i.amountDue, dueDate: i.dueDate })), new Date());
}

/** `billing.readPlatform` — the platform-staff sibling, for the admin org detail page (see `getOrganizationMrrSummaryForPlatform()`'s own doc comment for why this exists as a separate function rather than reusing the ORGANIZATION-scoped one above). */
export async function getOrganizationAgingReportForPlatform(rawInput: unknown): Promise<AgingReport> {
  const input = parseOrThrow(z.object({ organizationId: z.string().uuid() }), rawInput);
  await requirePermission("billing.readPlatform");
  const invoices = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) => invoiceRepository.listOpenForAging({ organizationId: input.organizationId }, tx));
  return computeAgingReport(invoices.map((i) => ({ invoiceId: i.id, organizationId: i.organizationId, currency: i.currency, amountDue: i.amountDue, dueDate: i.dueDate })), new Date());
}
