import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { summarizeRecognition, summarizeRecognitionInPeriod, type RecognitionLine, type RecognitionTotals } from "@/lib/billing/recognition/schedule";
import { resolvePeriod, splitIntoBuckets, PERIOD_NAMES, type FinancialPeriod } from "@/lib/billing/reporting/period";

/**
 * Revenue recognition reporting (Module 16) — `billing.compliance.read`,
 * PLATFORM-ONLY (see `revenue-recognition.md` "Why this is platform-
 * only, not organization-facing"). Every figure here derives from
 * `InvoiceLineItem.servicePeriodStart/End` (real Stripe data, captured
 * by `billing-webhook-service.ts` since Module 16) fed through the pure
 * `lib/billing/recognition/schedule.ts` engine — no separate
 * recognition ledger, no second source of truth.
 */

function toRecognitionLine(row: { id: string; invoiceId: string; organizationId: string; currency: string; total: number; servicePeriodStart: Date; servicePeriodEnd: Date }): RecognitionLine {
  return { lineItemId: row.id, invoiceId: row.invoiceId, organizationId: row.organizationId, currency: row.currency, amount: row.total, periodStart: row.servicePeriodStart, periodEnd: row.servicePeriodEnd };
}

export interface DeferredRevenueSummary {
  asOf: Date;
  totals: RecognitionTotals[];
  activeLineCount: number;
}

/**
 * `billing.compliance.read` — the platform's current deferred-revenue
 * BALANCE (a point-in-time liability figure, not a period-bounded
 * activity report) — every line item with servicePeriodEnd still in
 * the future, from real PAID/OPEN invoices.
 */
export async function getDeferredRevenueSummary(): Promise<DeferredRevenueSummary> {
  await requirePermission("billing.compliance.read");
  const asOf = new Date();
  const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => invoiceRepository.listLineItemsWithDeferredBalance({ platform: true }, asOf, tx));
  const lines = rows.map(toRecognitionLine);
  return { asOf, totals: summarizeRecognition(lines, asOf), activeLineCount: lines.length };
}

export interface RecognitionTrendPoint {
  bucketStart: Date;
  bucketEnd: Date;
  byCurrency: { currency: string; amount: number }[];
}

export interface RecognitionTrend {
  period: FinancialPeriod;
  points: RecognitionTrendPoint[];
}

const MAX_BUCKETS = 36; // same fixed upper bound `billing-trends-service.ts` already uses — a generous, non-caller-controlled cap

const trendInputSchema = z.object({
  period: z.enum(PERIOD_NAMES).default("current_year"),
  buckets: z.coerce.number().int().min(1).max(MAX_BUCKETS).default(12),
});

/**
 * `billing.compliance.read` — "how much revenue was recognized during
 * bucket N," one bucket at a time. Each bucket independently fetches
 * only the line items whose service period actually OVERLAPS it
 * (`listLineItemsOverlappingPeriod()` — never the platform's unbounded
 * line-item history), computed via the SAME pure `recognizedInPeriod()`
 * every other recognition figure in this module uses.
 */
export async function getPlatformRecognitionTrend(rawInput: unknown): Promise<RecognitionTrend> {
  await requirePermission("billing.compliance.read");
  const input = parseOrThrow(trendInputSchema, rawInput);
  const period = resolvePeriod(input.period, "UTC", new Date());
  const buckets = splitIntoBuckets(period, input.buckets);

  const points = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const result: RecognitionTrendPoint[] = [];
    for (const bucket of buckets) {
      const rows = await invoiceRepository.listLineItemsOverlappingPeriod({ platform: true }, bucket, tx);
      const lines = rows.map(toRecognitionLine);
      const summary = summarizeRecognitionInPeriod(lines, bucket);
      result.push({ bucketStart: bucket.start, bucketEnd: bucket.end, byCurrency: summary.map((s) => ({ currency: s.currency, amount: s.recognizedInPeriod })) });
    }
    return result;
  });

  return { period, points };
}
