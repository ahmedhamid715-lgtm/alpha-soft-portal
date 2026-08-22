import { describe, expect, it } from "vitest";
import {
  resolvePeriod,
  customPeriod,
  previousPeriodOf,
  isWithinPeriod,
  splitIntoBuckets,
  type FinancialPeriod,
} from "@/lib/billing/reporting/period";

describe("resolvePeriod", () => {
  // A fixed instant: 2026-08-22 15:30 UTC, which is 2026-08-22 11:30
  // in America/New_York (UTC-4, EDT in August) — a deliberately
  // "same calendar day in both zones" instant so UTC vs. NY assertions
  // below aren't accidentally testing the same thing twice.
  const now = new Date("2026-08-22T15:30:00.000Z");

  it("today: [start-of-day, start-of-next-day) in UTC", () => {
    const period = resolvePeriod("today", "UTC", now);
    expect(period.start.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-08-23T00:00:00.000Z");
    expect(period.label).toBe("today");
  });

  it("today: timezone-aware — America/New_York's 'today' starts 4 hours later in UTC (EDT, UTC-4)", () => {
    const period = resolvePeriod("today", "America/New_York", now);
    expect(period.start.toISOString()).toBe("2026-08-22T04:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-08-23T04:00:00.000Z");
  });

  it("current_month: full calendar month in UTC", () => {
    const period = resolvePeriod("current_month", "UTC", now);
    expect(period.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("previous_month: rolls back across a year boundary correctly (January -> previous December)", () => {
    const january = new Date("2027-01-15T12:00:00.000Z");
    const period = resolvePeriod("previous_month", "UTC", january);
    expect(period.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("current_quarter: August falls in Q3 (Jul-Sep)", () => {
    const period = resolvePeriod("current_quarter", "UTC", now);
    expect(period.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("previous_quarter: from Q3, the previous quarter is Q2 (Apr-Jun)", () => {
    const period = resolvePeriod("previous_quarter", "UTC", now);
    expect(period.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("previous_quarter: from Q1, the previous quarter is the PRIOR YEAR's Q4", () => {
    const q1 = new Date("2027-02-15T12:00:00.000Z");
    const period = resolvePeriod("previous_quarter", "UTC", q1);
    expect(period.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("current_year / previous_year", () => {
    expect(resolvePeriod("current_year", "UTC", now).start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(resolvePeriod("current_year", "UTC", now).end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(resolvePeriod("previous_year", "UTC", now).start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(resolvePeriod("previous_year", "UTC", now).end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is deterministic — the same (name, timeZone, now) always resolves identically, with no dependency on the real wall clock", () => {
    const a = resolvePeriod("current_month", "America/Los_Angeles", now);
    const b = resolvePeriod("current_month", "America/Los_Angeles", now);
    expect(a).toEqual(b);
  });
});

describe("customPeriod", () => {
  it("accepts a valid start < end range", () => {
    const period = customPeriod(new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), "UTC");
    expect(period.label).toBe("custom");
  });

  it("rejects start >= end", () => {
    expect(() => customPeriod(new Date("2026-02-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"), "UTC")).toThrow(RangeError);
    const same = new Date("2026-01-01T00:00:00Z");
    expect(() => customPeriod(same, same, "UTC")).toThrow(RangeError);
  });
});

describe("previousPeriodOf", () => {
  it("returns the immediately-preceding period of the SAME length", () => {
    const period: FinancialPeriod = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z"), timeZone: "UTC", label: "current_month" };
    const previous = previousPeriodOf(period);
    expect(previous.end).toEqual(period.start);
    expect(previous.end.getTime() - previous.start.getTime()).toBe(period.end.getTime() - period.start.getTime());
  });
});

describe("isWithinPeriod", () => {
  const period: FinancialPeriod = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z"), timeZone: "UTC", label: "current_month" };

  it("start boundary is inclusive", () => {
    expect(isWithinPeriod(period.start, period)).toBe(true);
  });

  it("end boundary is exclusive", () => {
    expect(isWithinPeriod(period.end, period)).toBe(false);
  });

  it("a date strictly inside is included; strictly outside is not", () => {
    expect(isWithinPeriod(new Date("2026-08-15T00:00:00Z"), period)).toBe(true);
    expect(isWithinPeriod(new Date("2026-07-31T23:59:59.999Z"), period)).toBe(false);
    expect(isWithinPeriod(new Date("2026-09-01T00:00:00.001Z"), period)).toBe(false);
  });
});

describe("splitIntoBuckets", () => {
  it("splits a period into N equal-length, contiguous buckets with no gaps or overlaps", () => {
    const period: FinancialPeriod = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-13T00:00:00Z"), timeZone: "UTC", label: "custom" };
    const buckets = splitIntoBuckets(period, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets[0]!.start).toEqual(period.start);
    expect(buckets[buckets.length - 1]!.end).toEqual(period.end);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.start).toEqual(buckets[i - 1]!.end); // contiguous — no gap, no overlap
    }
  });

  it("the last bucket's end is EXACTLY the period's end, never drifted by repeated rounding", () => {
    // 7 buckets over an odd-length period — a classic float-division
    // drift trap.
    const period: FinancialPeriod = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-08T03:17:00Z"), timeZone: "UTC", label: "custom" };
    const buckets = splitIntoBuckets(period, 7);
    expect(buckets[6]!.end.getTime()).toBe(period.end.getTime());
  });

  it("rejects count < 1", () => {
    const period: FinancialPeriod = { start: new Date(), end: new Date(Date.now() + 1000), timeZone: "UTC", label: "custom" };
    expect(() => splitIntoBuckets(period, 0)).toThrow(RangeError);
  });
});
