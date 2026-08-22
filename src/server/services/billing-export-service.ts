import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { audit } from "@/lib/audit/service";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { streamCsv, escapeCsvField, type CsvBatch } from "@/lib/billing/reporting/csv";
import { computeMrrByCurrency, type SubscriptionForMrr } from "@/lib/billing/reporting/mrr";
import { computeAgingReport } from "@/lib/billing/reporting/aging";
import { subscriptionRepository, type SubscriptionWithPricedItems } from "@/server/repositories/subscription-repository";
import { getCurrencyExponent } from "@/lib/utils/money";
import { summarizeRecognition } from "@/lib/billing/recognition/schedule";
import { summarizeTaxCollected } from "@/lib/billing/tax/compliance";
import { resolvePeriod, customPeriod } from "@/lib/billing/reporting/period";
import type { Invoice, Payment, Refund, CreditLedgerEntry } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/lib/authorization/context";

/**
 * Billing report exports (spec §12) — `billing.reports.export`
 * (platform_owner only — see permissions.ts) for the PLATFORM-wide
 * exports; the organization-scoped exports use the customer's own
 * `billing.read`/`billing.manage`... actually see each function's own
 * doc comment — an organization's OWN export of its OWN data is a
 * `billing.read` capability (the same permission that already lets an
 * owner/admin VIEW this data; exporting it as CSV isn't a materially
 * different risk), while a PLATFORM-wide cross-tenant export is the
 * separate, narrower `billing.reports.export`.
 *
 * Every export streams (`streamCsv()` — cursor-batched, never the full
 * result set in memory) EXCEPT the two aggregate reports (AR aging,
 * MRR) whose own result size is inherently small (one row per bucket/
 * currency, never more than a few dozen rows) — those still go through
 * the same escaping via `collectCsv`-equivalent inline construction,
 * just without the streaming machinery a naturally-small report doesn't
 * need.
 *
 * **Audit tradeoff, documented, not an oversight**: a genuinely
 * streamed export is audited with the REQUEST (who, filters, when) at
 * the moment the export starts — never a final row count, since
 * counting rows would require materializing the entire result before
 * responding, exactly the memory cost streaming exists to avoid. See
 * `billing-reporting-security.md` "Export auditing."
 */

/**
 * Money in an export column is written as a PLAIN decimal major-unit
 * string (e.g. `"199.99"`, never a locale-formatted `"$1,234.56"`,
 * which a spreadsheet would refuse to parse as a number) — built
 * directly from the INTEGER minor-unit value via string manipulation,
 * never via `minorUnits / 10 ** exponent` float division (spec's own
 * "never use floating-point arithmetic for money," which applies to
 * presentation output too, not just domain calculations — a genuinely
 * exact decimal string is required here since this value round-trips
 * into a spreadsheet's own arithmetic).
 */
function moneyColumn(minorUnits: number, currency: string): string {
  const exponent = getCurrencyExponent(currency);
  const negative = minorUnits < 0;
  const digits = Math.abs(minorUnits).toString().padStart(exponent + 1, "0");
  if (exponent === 0) return (negative ? "-" : "") + digits;
  const wholePart = digits.slice(0, -exponent);
  const fractionalPart = digits.slice(-exponent);
  return `${negative ? "-" : ""}${wholePart}.${fractionalPart}`;
}

/**
 * The RLS session context a streamed export's REPEATED, per-batch
 * `withTenantContext()` calls need. Deliberately NOT a single `tx`
 * handed to `streamCsv()` — a `ReadableStream`'s own `pull()` callback
 * runs LAZILY, invoked by whoever actually reads the stream (the HTTP
 * response layer, or this file's own tests), which happens AFTER the
 * exporting function itself has already returned and its
 * `withTenantContext()` transaction has already committed. A `tx`
 * captured in a closure at that point is a reference to an
 * ALREADY-CLOSED transaction — using it throws "Transaction already
 * closed" (a real bug found by this module's own database-integration
 * testing, not just reasoned about — see `billing-export-service.test.ts`).
 * The fix: each batch opens its OWN fresh, short-lived
 * `withTenantContext()` transaction — exactly the "transactions stay
 * short" discipline this codebase already follows everywhere else,
 * applied across N batches instead of one long-held connection for the
 * whole streamed response (which would also be a real resource-
 * exhaustion risk against a slow client).
 */
interface TenantScope {
  userId: string | null;
  organizationId: string | null;
  isPlatformStaff: boolean;
}

async function auditExport(context: AuthorizationContext, reportType: string, organizationId: string | null, filters: Record<string, unknown>): Promise<void> {
  await audit
    .recordSuccess({
      action: "billing.report.exported",
      organizationId,
      resourceType: "billing_report",
      resourceName: reportType,
      metadata: { reportType, filters },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record billing.report.exported", error));
}

const exportFilterSchema = z.object({ periodStart: z.coerce.date().optional(), periodEnd: z.coerce.date().optional() });
const platformExportSchema = exportFilterSchema;
const orgExportSchema = exportFilterSchema.extend({ organizationId: z.string().uuid() });

// --- Invoices ---------------------------------------------------------

function invoiceCsvSpec(tenantScope: TenantScope, scope: { organizationId: string } | { platform: true }, filter: { periodStart?: Date; periodEnd?: Date }) {
  return {
    headers: ["invoice_number", "organization_id", "status", "currency", "subtotal", "total", "amount_paid", "amount_due", "issue_date", "due_date", "paid_at"],
    toRow: (row: Invoice) => [row.invoiceNumber, row.organizationId, row.status, row.currency, moneyColumn(row.subtotal, row.currency), moneyColumn(row.total, row.currency), moneyColumn(row.amountPaid, row.currency), moneyColumn(row.amountDue, row.currency), row.issueDate, row.dueDate, row.paidAt],
    fetchBatch: async (cursor: string | null): Promise<CsvBatch<Invoice, string>> => {
      const page = await withTenantContext(tenantScope, (tx) => invoiceRepository.listForExport(scope, filter, { cursor: cursor ?? undefined, limit: 500 }, tx));
      return { rows: page.items, nextCursor: page.pageInfo.nextCursor };
    },
  };
}

/** `billing.reports.export` — platform-wide invoice CSV, streamed. */
export async function exportPlatformInvoices(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(platformExportSchema, rawInput);
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "invoices", null, input);
  return streamCsv(invoiceCsvSpec({ userId: null, organizationId: null, isPlatformStaff: true }, { platform: true }, input));
}

/** `billing.read` (ORGANIZATION) — this organization's own invoice CSV. */
export async function exportOrganizationInvoices(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(orgExportSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  await auditExport(context, "invoices", input.organizationId, input);
  return streamCsv(invoiceCsvSpec({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, { organizationId: input.organizationId }, input));
}

// --- Payments -----------------------------------------------------------

function paymentCsvSpec(tenantScope: TenantScope, scope: { organizationId: string } | { platform: true }, filter: { periodStart?: Date; periodEnd?: Date }) {
  return {
    headers: ["payment_id", "organization_id", "status", "currency", "amount", "payment_method_brand", "payment_method_last4", "created_at", "paid_at"],
    toRow: (row: Payment) => [row.id, row.organizationId, row.status, row.currency, moneyColumn(row.amount, row.currency), row.paymentMethodBrand, row.paymentMethodLast4, row.createdAt, row.paidAt],
    fetchBatch: async (cursor: string | null): Promise<CsvBatch<Payment, string>> => {
      const page = await withTenantContext(tenantScope, (tx) => paymentRepository.listForExport(scope, filter, { cursor: cursor ?? undefined, limit: 500 }, tx));
      return { rows: page.items, nextCursor: page.pageInfo.nextCursor };
    },
  };
}

/** `billing.reports.export` — platform-wide payment CSV, streamed. Never includes a full payment-method number — only the same safe, already-tokenized display fields the rest of this codebase exposes (spec §12/§38). */
export async function exportPlatformPayments(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(platformExportSchema, rawInput);
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "payments", null, input);
  return streamCsv(paymentCsvSpec({ userId: null, organizationId: null, isPlatformStaff: true }, { platform: true }, input));
}

/** `billing.read` (ORGANIZATION) — this organization's own payment CSV. */
export async function exportOrganizationPayments(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(orgExportSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  await auditExport(context, "payments", input.organizationId, input);
  return streamCsv(paymentCsvSpec({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, { organizationId: input.organizationId }, input));
}

// --- Refunds --------------------------------------------------------------

function refundCsvSpec(tenantScope: TenantScope, scope: { organizationId: string } | { platform: true }, filter: { periodStart?: Date; periodEnd?: Date }) {
  return {
    headers: ["refund_id", "organization_id", "payment_id", "status", "currency", "amount", "reason", "created_at"],
    toRow: (row: Refund & { payment: { organizationId: string } }) => [row.id, row.payment.organizationId, row.paymentId, row.status, row.currency, moneyColumn(row.amount, row.currency), row.reason, row.createdAt],
    fetchBatch: async (cursor: string | null): Promise<CsvBatch<Refund & { payment: { organizationId: string } }, string>> => {
      const page = await withTenantContext(tenantScope, (tx) => refundRepository.listForExport(scope, filter, { cursor: cursor ?? undefined, limit: 500 }, tx));
      return { rows: page.items, nextCursor: page.pageInfo.nextCursor };
    },
  };
}

/** `billing.reports.export` — platform-wide refund CSV, streamed. */
export async function exportPlatformRefunds(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(platformExportSchema, rawInput);
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "refunds", null, input);
  return streamCsv(refundCsvSpec({ userId: null, organizationId: null, isPlatformStaff: true }, { platform: true }, input));
}

/** `billing.read` (ORGANIZATION) — this organization's own refund CSV. */
export async function exportOrganizationRefunds(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(orgExportSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  await auditExport(context, "refunds", input.organizationId, input);
  return streamCsv(refundCsvSpec({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, { organizationId: input.organizationId }, input));
}

// --- Credit ledger --------------------------------------------------------

function creditCsvSpec(tenantScope: TenantScope, scope: { organizationId: string } | { platform: true }, filter: { periodStart?: Date; periodEnd?: Date }) {
  return {
    headers: ["entry_id", "organization_id", "type", "currency", "amount", "reason", "related_entry_id", "created_at"],
    toRow: (row: CreditLedgerEntry) => [row.id, row.organizationId, row.type, row.currency, moneyColumn(row.amount, row.currency), row.reason, row.relatedEntryId, row.createdAt],
    fetchBatch: async (cursor: string | null): Promise<CsvBatch<CreditLedgerEntry, string>> => {
      const page = await withTenantContext(tenantScope, (tx) => creditLedgerRepository.listForExport(scope, filter, { cursor: cursor ?? undefined, limit: 500 }, tx));
      return { rows: page.items, nextCursor: page.pageInfo.nextCursor };
    },
  };
}

/** `billing.reports.export` — platform-wide credit ledger CSV, streamed. */
export async function exportPlatformCredits(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(platformExportSchema, rawInput);
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "credits", null, input);
  return streamCsv(creditCsvSpec({ userId: null, organizationId: null, isPlatformStaff: true }, { platform: true }, input));
}

/** `billing.read` (ORGANIZATION) — this organization's own credit ledger CSV. */
export async function exportOrganizationCredits(rawInput: unknown): Promise<ReadableStream<Uint8Array>> {
  const input = parseOrThrow(orgExportSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  await auditExport(context, "credits", input.organizationId, input);
  return streamCsv(creditCsvSpec({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, { organizationId: input.organizationId }, input));
}

// --- Aggregate reports (AR aging, MRR) — small by nature, not streamed ----

function csvLine(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** `billing.reports.export` — platform-wide AR aging CSV. A handful of rows (bucket x currency) — collected directly, no cursor batching needed. */
export async function exportPlatformAging(): Promise<string> {
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "ar_aging", null, {});
  const invoices = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => invoiceRepository.listOpenForAging({ platform: true }, tx));
  const report = computeAgingReport(invoices.map((i) => ({ invoiceId: i.id, organizationId: i.organizationId, currency: i.currency, amountDue: i.amountDue, dueDate: i.dueDate })), new Date());
  const lines = [csvLine(["bucket", "currency", "amount", "invoice_count"])];
  for (const bucket of report.buckets) lines.push(csvLine([bucket.bucket, bucket.currency, moneyColumn(bucket.amount, bucket.currency), bucket.invoiceCount]));
  return lines.join("\n");
}

function toSubscriptionForMrr(subscription: SubscriptionWithPricedItems): SubscriptionForMrr {
  return {
    subscriptionId: subscription.id,
    organizationId: subscription.organizationId,
    status: subscription.status,
    items: subscription.items.map((item) => ({ planPriceUnitAmount: item.planPrice.unitAmount, planPriceInterval: item.planPrice.interval, planPriceCurrency: item.planPrice.currency, quantity: item.quantity })),
  };
}

/** `billing.reports.export` — platform-wide MRR/ARR CSV, one row per currency. */
export async function exportPlatformMrr(): Promise<string> {
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "mrr", null, {});
  const subscriptions = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => subscriptionRepository.listWithPricedItems({ platform: true }, tx));
  const byCurrency = computeMrrByCurrency(subscriptions.map(toSubscriptionForMrr));
  const lines = [csvLine(["currency", "mrr", "arr", "subscription_count"])];
  for (const row of byCurrency) lines.push(csvLine([row.currency, moneyColumn(row.mrr, row.currency), moneyColumn(row.arr, row.currency), row.subscriptionCount]));
  return lines.join("\n");
}

/**
 * `billing.reports.export` — Module 16. Deferred-revenue CSV, a
 * point-in-time balance ("as of now"), the same aggregate-not-streamed
 * shape `exportPlatformAging()`/`exportPlatformMrr()` already use — this
 * report's own row count is bounded by currency count, never a
 * per-invoice scan.
 */
export async function exportPlatformRevenueRecognition(): Promise<string> {
  const context = await requirePermission("billing.reports.export");
  await auditExport(context, "revenue_recognition", null, {});
  const asOf = new Date();
  const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => invoiceRepository.listLineItemsWithDeferredBalance({ platform: true }, asOf, tx));
  const lines = summarizeRecognition(
    rows.map((r) => ({ lineItemId: r.id, invoiceId: r.invoiceId, organizationId: r.organizationId, currency: r.currency, amount: r.total, periodStart: r.servicePeriodStart, periodEnd: r.servicePeriodEnd })),
    asOf,
  );
  const csvLines = [csvLine(["currency", "total_billed", "recognized", "deferred", "as_of"])];
  for (const row of lines) csvLines.push(csvLine([row.currency, moneyColumn(row.totalBilled, row.currency), moneyColumn(row.recognized, row.currency), moneyColumn(row.deferred, row.currency), asOf]));
  return csvLines.join("\n");
}

const taxExportSchema = z.object({ periodStart: z.coerce.date().optional(), periodEnd: z.coerce.date().optional() });

/**
 * `billing.reports.export` — Module 16. Tax-collected CSV, broken down
 * by currency/taxability reason/provider tax rate reference, for
 * invoices issued in the requested period (defaults to the current
 * month, same default `revenue-reporting-service.ts`'s own org-scoped
 * function already uses when nothing is specified).
 */
export async function exportPlatformTaxCompliance(rawInput: unknown): Promise<string> {
  const context = await requirePermission("billing.reports.export");
  const input = parseOrThrow(taxExportSchema, rawInput);
  await auditExport(context, "tax_compliance", null, input);
  const period = input.periodStart && input.periodEnd ? customPeriod(input.periodStart, input.periodEnd, "UTC") : resolvePeriod("current_month", "UTC", new Date());
  const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => invoiceRepository.listLineItemTaxesForPeriod({ platform: true }, period, tx));
  const breakdown = summarizeTaxCollected(rows);
  const lines = [csvLine(["currency", "taxability_reason", "provider_tax_rate_id", "amount", "component_count"])];
  for (const row of breakdown) lines.push(csvLine([row.currency, row.taxabilityReason, row.providerTaxRateId, moneyColumn(row.amount, row.currency), row.componentCount]));
  return lines.join("\n");
}
