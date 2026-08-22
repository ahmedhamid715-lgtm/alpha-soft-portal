import { describe, expect, it } from "vitest";
import { recognizedAsOf, deferredAsOf, recognizedInPeriod, summarizeRecognition, summarizeRecognitionInPeriod, type RecognitionLine } from "@/lib/billing/recognition/schedule";
import { customPeriod } from "@/lib/billing/reporting/period";

const MONTH_LINE = { amount: 3000, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z") }; // a 31-day period, $30.00

describe("recognizedAsOf", () => {
  it("is 0 before the period starts", () => {
    expect(recognizedAsOf(MONTH_LINE, new Date("2025-12-31T00:00:00.000Z"))).toBe(0);
  });

  it("is 0 exactly at periodStart", () => {
    expect(recognizedAsOf(MONTH_LINE, MONTH_LINE.periodStart)).toBe(0);
  });

  it("is fully recognized at or after periodEnd", () => {
    expect(recognizedAsOf(MONTH_LINE, MONTH_LINE.periodEnd)).toBe(3000);
    expect(recognizedAsOf(MONTH_LINE, new Date("2026-06-01T00:00:00.000Z"))).toBe(3000);
  });

  it("is exactly half at the period's own midpoint", () => {
    // 2026-01-16T00:00:00Z is exactly half of a 31-day period (Jan 1 00:00 -> Feb 1 00:00)
    const midpoint = new Date(MONTH_LINE.periodStart.getTime() + (MONTH_LINE.periodEnd.getTime() - MONTH_LINE.periodStart.getTime()) / 2);
    expect(recognizedAsOf(MONTH_LINE, midpoint)).toBe(1500);
  });

  it("is a proportional fraction partway through the period", () => {
    // 1 day into a 31-day period: 3000 * (1/31) = 96.77... -> integer-truncated by BigInt division
    const oneDayIn = new Date("2026-01-02T00:00:00.000Z");
    const result = recognizedAsOf(MONTH_LINE, oneDayIn);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(3000);
    expect(result).toBe(Math.floor((3000 * 24 * 60 * 60 * 1000) / (31 * 24 * 60 * 60 * 1000)));
  });

  it("a zero-length period (periodStart === periodEnd, a one-time charge) is fully recognized instantly at periodStart, never partially deferred", () => {
    const instant = new Date("2026-03-15T12:00:00.000Z");
    const oneTime = { amount: 5000, periodStart: instant, periodEnd: instant };
    expect(recognizedAsOf(oneTime, new Date("2026-03-15T11:59:59.999Z"))).toBe(0);
    expect(recognizedAsOf(oneTime, instant)).toBe(5000);
    expect(recognizedAsOf(oneTime, new Date("2026-04-01T00:00:00.000Z"))).toBe(5000);
  });

  it("a defensively-malformed inverted period (periodEnd < periodStart) is treated the same as a zero-length one, never negative or NaN", () => {
    const inverted = { amount: 1000, periodStart: new Date("2026-01-10T00:00:00.000Z"), periodEnd: new Date("2026-01-05T00:00:00.000Z") };
    expect(recognizedAsOf(inverted, new Date("2026-01-01T00:00:00.000Z"))).toBe(0);
    expect(recognizedAsOf(inverted, new Date("2026-01-10T00:00:00.000Z"))).toBe(1000);
  });

  it("is exact (BigInt-safe) for a very large amount over a full year, never a Number-overflow approximation", () => {
    const bigLine = { amount: 999_999_999, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2027-01-01T00:00:00.000Z") };
    const halfYear = new Date("2026-07-02T12:00:00.000Z"); // exact midpoint of a 365-day 2026
    const result = recognizedAsOf(bigLine, halfYear);
    const totalMs = bigLine.periodEnd.getTime() - bigLine.periodStart.getTime();
    const elapsedMs = halfYear.getTime() - bigLine.periodStart.getTime();
    expect(result).toBe(Math.floor((999_999_999 * elapsedMs) / totalMs));
  });

  it("never exceeds line.amount even for an asOf far past periodEnd", () => {
    expect(recognizedAsOf(MONTH_LINE, new Date("2099-01-01T00:00:00.000Z"))).toBe(3000);
  });
});

describe("deferredAsOf", () => {
  it("is amount - recognizedAsOf, always summing back to the original amount", () => {
    const asOf = new Date("2026-01-10T00:00:00.000Z");
    expect(recognizedAsOf(MONTH_LINE, asOf) + deferredAsOf(MONTH_LINE, asOf)).toBe(MONTH_LINE.amount);
  });

  it("is the full amount before the period starts and zero after it ends", () => {
    expect(deferredAsOf(MONTH_LINE, new Date("2025-01-01T00:00:00.000Z"))).toBe(3000);
    expect(deferredAsOf(MONTH_LINE, new Date("2027-01-01T00:00:00.000Z"))).toBe(0);
  });
});

describe("recognizedInPeriod", () => {
  it("is the delta between recognizedAsOf at the report period's start and end", () => {
    const reportPeriod = customPeriod(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-16T00:00:00.000Z"), "UTC");
    const result = recognizedInPeriod(MONTH_LINE, reportPeriod);
    expect(result).toBe(recognizedAsOf(MONTH_LINE, reportPeriod.end) - recognizedAsOf(MONTH_LINE, reportPeriod.start));
    expect(result).toBeGreaterThan(0);
  });

  it("is 0 for a report period entirely before the line's own period starts", () => {
    const reportPeriod = customPeriod(new Date("2025-01-01T00:00:00.000Z"), new Date("2025-02-01T00:00:00.000Z"), "UTC");
    expect(recognizedInPeriod(MONTH_LINE, reportPeriod)).toBe(0);
  });

  it("across two adjacent report periods, the sum equals the full recognizedAsOf at the later boundary — no double-count, no gap", () => {
    const first = customPeriod(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-16T00:00:00.000Z"), "UTC");
    const second = customPeriod(new Date("2026-01-16T00:00:00.000Z"), new Date("2026-02-01T00:00:00.000Z"), "UTC");
    const sum = recognizedInPeriod(MONTH_LINE, first) + recognizedInPeriod(MONTH_LINE, second);
    expect(sum).toBe(recognizedAsOf(MONTH_LINE, second.end));
  });
});

describe("summarizeRecognition", () => {
  const lines: RecognitionLine[] = [
    { lineItemId: "l1", invoiceId: "i1", organizationId: "orgA", currency: "USD", amount: 3000, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z") },
    { lineItemId: "l2", invoiceId: "i2", organizationId: "orgB", currency: "USD", amount: 5000, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z") },
    { lineItemId: "l3", invoiceId: "i3", organizationId: "orgC", currency: "EUR", amount: 1000, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z") },
  ];

  it("groups by currency, never blending USD and EUR into one row", () => {
    const result = summarizeRecognition(lines, new Date("2026-02-01T00:00:00.000Z"));
    expect(result).toHaveLength(2);
    const usd = result.find((r) => r.currency === "USD")!;
    const eur = result.find((r) => r.currency === "EUR")!;
    expect(usd.totalBilled).toBe(8000);
    expect(eur.totalBilled).toBe(1000);
  });

  it("recognized + deferred always equals totalBilled, per currency", () => {
    const result = summarizeRecognition(lines, new Date("2026-01-16T00:00:00.000Z"));
    for (const row of result) {
      expect(row.recognized + row.deferred).toBe(row.totalBilled);
    }
  });

  it("an empty line list returns an empty array, not a zero-row placeholder", () => {
    expect(summarizeRecognition([], new Date())).toEqual([]);
  });
});

describe("summarizeRecognitionInPeriod", () => {
  it("groups by currency and sums recognizedInPeriod across lines", () => {
    const lines: RecognitionLine[] = [
      { lineItemId: "l1", invoiceId: "i1", organizationId: "orgA", currency: "USD", amount: 3100, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z") },
      { lineItemId: "l2", invoiceId: "i2", organizationId: "orgB", currency: "USD", amount: 3100, periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z") },
    ];
    const reportPeriod = customPeriod(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"), "UTC"); // exactly 1 of 31 days
    const result = summarizeRecognitionInPeriod(lines, reportPeriod);
    expect(result).toEqual([{ currency: "USD", recognizedInPeriod: 200 }]); // 100 + 100 (3100/31 = 100 exactly, per line)
  });
});
