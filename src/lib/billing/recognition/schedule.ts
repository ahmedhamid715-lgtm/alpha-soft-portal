import { addMoney } from "@/lib/utils/money";
import type { FinancialPeriod } from "@/lib/billing/reporting/period";

/**
 * Revenue recognition (Module 16) — pure, deterministic, ratable
 * (straight-line) recognition of INVOICED subscription revenue over the
 * real service period it was billed for. This is the standard treatment
 * for a SaaS subscription's single performance obligation delivered
 * evenly over time (the ASC 606 / IFRS 15 pattern virtually every
 * subscription-billing platform uses for its own recurring-revenue
 * lines) — a real, honest, auditable calculation, not a certified GAAP
 * engine (see `revenue-recognition.md` "What this does NOT claim to
 * be").
 *
 * **Basis: BILLED, not cash, not a forecast.** A line item's `amount`
 * is recognized ratably across `[periodStart, periodEnd)` regardless of
 * whether it has actually been PAID yet — the same "billed vs.
 * collected are different things" discipline Module 15's own
 * `revenue-metrics.md` already established for BILLED vs. COLLECTED.
 * Whether an invoice was ever paid is a Module 15 concern (AR aging,
 * financial health); this module answers a different question — "of
 * what we billed, how much of it has been EARNED as of a given date."
 *
 * **Amount excludes tax.** `RecognitionLine.amount` must be the line's
 * `InvoiceLineItem.total` (already net of discount, tax-EXCLUDED per
 * this codebase's own Stripe-mapping convention — see
 * `billing-webhook-service.ts`'s line-item mapping) — tax collected is
 * a liability owed to a taxing authority, never revenue, so it must
 * never be recognized.
 *
 * **Source of the period**: `InvoiceLineItem.servicePeriodStart/End`
 * (Module 16's own schema addition, captured from Stripe's own
 * `line.period`, always present on the real provider payload). Stripe
 * documents its `period.end` as "inclusive"; in practice, for a genuine
 * subscription line, Stripe already sets it to exactly the instant the
 * NEXT period begins — so this module treats it as the exclusive
 * boundary of a half-open range directly, the same `[start, end)`
 * convention `lib/billing/reporting/period.ts` already established,
 * with no adjustment needed.
 *
 * **Zero-length period** (`periodStart === periodEnd`, or `periodEnd <
 * periodStart` as a defensive fallback) — Stripe's own representation
 * of a ONE-TIME charge (a true point-in-time obligation, not something
 * delivered "over time" at all). Correctly and deliberately NOT a
 * special case in the formula below: it is recognized in full, exactly
 * at `periodStart`, the accounting-correct treatment for a one-time
 * fee — never partially deferred.
 */

export interface RecognitionLine {
  lineItemId: string;
  invoiceId: string;
  organizationId: string;
  currency: string;
  /** Minor units — see this file's own top comment ("Amount excludes tax"). */
  amount: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Minor units recognized by `asOf`, bounded to `[0, line.amount]`.
 * Uses `BigInt` for the `amount * elapsedMs` multiplication
 * DELIBERATELY — a naive `Number` multiplication can exceed
 * `Number.MAX_SAFE_INTEGER` for a large invoice over a long period
 * (e.g. a seven-figure minor-units amount times a year in
 * milliseconds), which would silently corrupt the result. `BigInt`
 * makes this exact regardless of scale, the same "never approximate
 * money" discipline this codebase applies everywhere else, just with a
 * different tool for a genuinely large-number case pure `Number`
 * arithmetic can't safely cover.
 */
export function recognizedAsOf(line: Pick<RecognitionLine, "amount" | "periodStart" | "periodEnd">, asOf: Date): number {
  const start = line.periodStart.getTime();
  const end = line.periodEnd.getTime();
  const at = asOf.getTime();

  if (end <= start) return at >= start ? line.amount : 0;
  if (at <= start) return 0;
  if (at >= end) return line.amount;

  const totalMs = BigInt(end - start);
  const elapsedMs = BigInt(at - start);
  const amount = BigInt(line.amount);
  const recognized = Number((amount * elapsedMs) / totalMs);
  return Math.min(Math.max(recognized, 0), line.amount);
}

/** Minor units still unrecognized (deferred) as of `asOf` — `line.amount - recognizedAsOf(line, asOf)`, always in `[0, line.amount]`. */
export function deferredAsOf(line: Pick<RecognitionLine, "amount" | "periodStart" | "periodEnd">, asOf: Date): number {
  return line.amount - recognizedAsOf(line, asOf);
}

/**
 * How much of this line was recognized DURING `period` specifically —
 * `recognizedAsOf(period.end) - recognizedAsOf(period.start)`. Reuses
 * `FinancialPeriod`'s own `[start, end)` convention directly (spec's
 * own "one shared date-range abstraction, never reinvented per
 * report").
 */
export function recognizedInPeriod(line: Pick<RecognitionLine, "amount" | "periodStart" | "periodEnd">, period: FinancialPeriod): number {
  return recognizedAsOf(line, period.end) - recognizedAsOf(line, period.start);
}

export interface RecognitionTotals {
  currency: string;
  /** Sum of every line's own `amount` — the total billed revenue these lines represent, undiminished. */
  totalBilled: number;
  recognized: number;
  deferred: number;
}

/**
 * Aggregates many lines into one row PER CURRENCY as of `asOf` — never
 * blended (spec's own "currencies are never summed together";
 * `addMoney()` enforces this by throwing on any accidental mismatch,
 * though grouping by currency below means it's never actually called
 * with mismatched currencies).
 */
export function summarizeRecognition(lines: RecognitionLine[], asOf: Date): RecognitionTotals[] {
  const totals = new Map<string, RecognitionTotals>();
  for (const line of lines) {
    const existing = totals.get(line.currency) ?? { currency: line.currency, totalBilled: 0, recognized: 0, deferred: 0 };
    const recognized = recognizedAsOf(line, asOf);
    existing.totalBilled = addMoney({ minorUnits: existing.totalBilled, currency: line.currency }, { minorUnits: line.amount, currency: line.currency }).minorUnits;
    existing.recognized = addMoney({ minorUnits: existing.recognized, currency: line.currency }, { minorUnits: recognized, currency: line.currency }).minorUnits;
    existing.deferred = addMoney({ minorUnits: existing.deferred, currency: line.currency }, { minorUnits: line.amount - recognized, currency: line.currency }).minorUnits;
    totals.set(line.currency, existing);
  }
  return Array.from(totals.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface RecognitionPeriodTotals {
  currency: string;
  recognizedInPeriod: number;
}

/** Same grouping discipline as `summarizeRecognition()`, but "how much was recognized DURING this specific period" — the trend chart's own x-axis input (one call per bucket, via `splitIntoBuckets()`). */
export function summarizeRecognitionInPeriod(lines: RecognitionLine[], period: FinancialPeriod): RecognitionPeriodTotals[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const amount = recognizedInPeriod(line, period);
    totals.set(line.currency, addMoney({ minorUnits: totals.get(line.currency) ?? 0, currency: line.currency }, { minorUnits: amount, currency: line.currency }).minorUnits);
  }
  return Array.from(totals.entries())
    .map(([currency, recognizedInPeriod]) => ({ currency, recognizedInPeriod }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
