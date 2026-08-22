import { addMoney } from "@/lib/utils/money";

/**
 * Accounts-receivable aging (spec §6) — pure, deterministic, over
 * already-fetched OPEN invoices. "Receivable" here means exactly one
 * thing: an `Invoice` with `status = "OPEN"` and `amountDue > 0` — a
 * DRAFT invoice was never finalized (not yet a real obligation), a PAID
 * invoice has nothing outstanding, and VOID/UNCOLLECTIBLE are no longer
 * expected to collect at all (spec's own "void/canceled invoices... if
 * supported" — VOID means the invoice was withdrawn; UNCOLLECTIBLE
 * means the platform has already given up expecting payment — neither
 * belongs in a report of money still reasonably expected). The service
 * layer is responsible for filtering to exactly these rows before
 * calling this module.
 *
 * A PARTIALLY-paid invoice is already correctly represented: Stripe
 * (and this codebase's own invoice lifecycle) keeps `status` at `OPEN`
 * until `amountDue` reaches zero — the bucket amount below is always
 * `amountDue`, the actual OUTSTANDING balance, never `total`.
 */

export const AGING_BUCKETS = ["current", "1_30", "31_60", "61_90", "91_120", "120_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  "1_30": "1–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "91_120": "91–120 days",
  "120_plus": "120+ days",
};

export interface OpenInvoiceForAging {
  invoiceId: string;
  organizationId: string;
  currency: string;
  /** The OUTSTANDING amount — never `total` (spec §6: aging reports the receivable, not the original billed amount). */
  amountDue: number;
  /** `null` is a real, valid state (an invoice issued with no due date) — bucketed as `"current"`, since nothing has actually come due (see `bucketForInvoice()`'s own doc comment). */
  dueDate: Date | null;
}

/**
 * Whole UTC calendar days between `dueDate` and `asOf` — never negative
 * (an invoice not yet due is 0 days overdue, bucketed `"current"`).
 * `asOf` is always an explicit parameter (spec §19: deterministic,
 * testable — never `new Date()` computed inside this pure function).
 * UTC is used for BOTH the platform-wide and the organization-scoped
 * view (a documented simplification, not an oversight — see
 * `billing-intelligence.md` "Date semantics": a platform aggregate has
 * no single "local day," and using UTC consistently in both views means
 * the SAME invoice is never bucketed differently depending on which
 * view happened to render it).
 */
export function daysOverdue(dueDate: Date | null, asOf: Date): number {
  if (dueDate === null) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  const dueDayUtc = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const asOfDayUtc = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.max(0, Math.round((asOfDayUtc - dueDayUtc) / msPerDay));
}

export function bucketForInvoice(invoice: OpenInvoiceForAging, asOf: Date): AgingBucket {
  const overdue = daysOverdue(invoice.dueDate, asOf);
  if (overdue === 0) return "current";
  if (overdue <= 30) return "1_30";
  if (overdue <= 60) return "31_60";
  if (overdue <= 90) return "61_90";
  if (overdue <= 120) return "91_120";
  return "120_plus";
}

export interface AgingBucketTotal {
  bucket: AgingBucket;
  currency: string;
  /** Minor units — the sum of `amountDue` for every invoice in this bucket. */
  amount: number;
  invoiceCount: number;
}

export interface AgingReport {
  asOf: Date;
  /** One row per (bucket, currency) combination that has at least one invoice — never a zero row for an empty bucket/currency pair (spec's own "deterministic totals," not a padded matrix). */
  buckets: AgingBucketTotal[];
  totalOutstandingByCurrency: { currency: string; amount: number }[];
}

export function computeAgingReport(invoices: OpenInvoiceForAging[], asOf: Date): AgingReport {
  const bucketTotals = new Map<string, AgingBucketTotal>();
  const currencyTotals = new Map<string, number>();

  for (const invoice of invoices) {
    if (invoice.amountDue <= 0) continue; // fully collected in practice despite still being OPEN — nothing outstanding to age
    const bucket = bucketForInvoice(invoice, asOf);
    const key = `${bucket}:${invoice.currency}`;
    const existing = bucketTotals.get(key);
    if (existing) {
      existing.amount = addMoney({ minorUnits: existing.amount, currency: invoice.currency }, { minorUnits: invoice.amountDue, currency: invoice.currency }).minorUnits;
      existing.invoiceCount += 1;
    } else {
      bucketTotals.set(key, { bucket, currency: invoice.currency, amount: invoice.amountDue, invoiceCount: 1 });
    }
    const currencyTotal = currencyTotals.get(invoice.currency) ?? 0;
    currencyTotals.set(invoice.currency, addMoney({ minorUnits: currencyTotal, currency: invoice.currency }, { minorUnits: invoice.amountDue, currency: invoice.currency }).minorUnits);
  }

  const buckets = Array.from(bucketTotals.values()).sort((a, b) => AGING_BUCKETS.indexOf(a.bucket) - AGING_BUCKETS.indexOf(b.bucket) || a.currency.localeCompare(b.currency));
  const totalOutstandingByCurrency = Array.from(currencyTotals.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return { asOf, buckets, totalOutstandingByCurrency };
}
