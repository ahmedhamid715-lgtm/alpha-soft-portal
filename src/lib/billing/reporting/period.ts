/**
 * The one financial-period abstraction every Module 15 report shares
 * (spec §13: "Create one clear date-range abstraction... Do not
 * duplicate date-range parsing in every report"). Pure — no database
 * access, no `Date.now()` default hidden inside a function that claims
 * to be deterministic (see `resolvePeriod()`'s own `now` parameter).
 *
 * **Boundaries are always `[start, end)`** — inclusive start, EXCLUSIVE
 * end. A period never needs an "end of day 23:59:59.999" fudge: "current
 * month" is `[first-of-month 00:00:00, first-of-NEXT-month 00:00:00)`,
 * and a record belongs to the period iff `start <= record.date < end`.
 * This is the same boundary convention `cursorPaginationSchema`'s own
 * "fetch limit+1" trick uses for a similar reason — half-open ranges
 * compose without off-by-one errors when chained (yesterday's `end` is
 * exactly today's `start`).
 *
 * **Timezone**: every named period (`"current_month"`, `"previous_quarter"`,
 * ...) is anchored to an explicit IANA timezone the caller supplies —
 * this module has no implicit default. Two documented choices upstream:
 * an ORGANIZATION-scoped report anchors to that organization's own
 * `Organization.timezone`; a PLATFORM-WIDE report anchors to UTC (spec
 * §14/reporting-security's own reasoning: organizations span many
 * timezones, so a platform aggregate has no single "local day" to be
 * consistent about — UTC is the only boundary every organization agrees
 * is the same instant). See `billing-intelligence.md` "Date semantics."
 */

export interface FinancialPeriod {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
  timeZone: string;
  /** The named period this was resolved from, or `"custom"`. Carried through for display/audit context — never re-derived from `start`/`end` alone (a custom range that happens to equal a calendar month is still `"custom"`, not silently reclassified). */
  label: PeriodName | "custom";
}

export const PERIOD_NAMES = [
  "today",
  "current_month",
  "previous_month",
  "current_quarter",
  "previous_quarter",
  "current_year",
  "previous_year",
] as const;
export type PeriodName = (typeof PERIOD_NAMES)[number];

/** Fetches the wall-clock Y/M/D "as observed in `timeZone`" for `instant` — the one non-obvious primitive every named-period calculation below needs (`Intl.DateTimeFormat`, no date library — same discipline `lib/utils/datetime.ts` already established). */
function wallClockParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Same as `wallClockParts`, plus time-of-day — needed by `startOfDayUtc()`'s own offset arithmetic below (a Y/M/D-only reading throws away exactly the information needed to compute a sub-day UTC offset correctly). */
function wallClockInstantAsUtc(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/**
 * The UTC instant corresponding to `year-month-day 00:00:00` AS OBSERVED
 * in `timeZone`. No fixed offset table (no date-library dependency):
 * treat the target Y/M/D/00:00:00 AS IF it were already a UTC instant
 * (`target`), measure how far that guess's OWN wall-clock reading in
 * `timeZone` drifts from itself (`offset = wallClockInstantAsUtc(target,
 * timeZone) - target`), then subtract that drift — the real instant
 * whose `timeZone` wall clock reads exactly `target`. Re-measured once
 * more at the corrected instant and re-applied if the offset itself
 * changed (the corrected instant crossed a DST transition relative to
 * the initial guess) — two passes is provably sufficient since no real
 * IANA zone's offset changes twice within one UTC day.
 */
function startOfDayUtc(year: number, month: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let candidate = target - (wallClockInstantAsUtc(new Date(target), timeZone) - target);
  const offsetAtCandidate = wallClockInstantAsUtc(new Date(candidate), timeZone) - candidate;
  candidate = target - offsetAtCandidate;
  return new Date(candidate);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1 };
}

/**
 * Resolves a named period, anchored to `timeZone`, as-of `now` (the
 * caller's own current instant — always passed explicitly, never
 * defaulted to `new Date()` inside this pure function, so every period
 * calculation stays deterministic and testable without mocking global
 * time — spec §19).
 */
export function resolvePeriod(name: PeriodName, timeZone: string, now: Date): FinancialPeriod {
  const { year, month, day } = wallClockParts(now, timeZone);

  switch (name) {
    case "today": {
      const start = startOfDayUtc(year, month, day, timeZone);
      // A plain +24h from a correctly-resolved local midnight — safe even
      // across a DST transition, because `startOfDayUtc` already
      // resolved `start` to the exact UTC instant of THIS day's local
      // midnight; the exclusive `end` boundary only needs to be the
      // start of the NEXT calendar day, and re-running the same
      // timezone-aware resolution one day later stays correct even if
      // that next day is a different length in wall-clock terms
      // (a DST-transition day) — `end` is still exactly the instant
      // "today's records" stop and "tomorrow's" begin.
      const tomorrowWallClock = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowParts = wallClockParts(tomorrowWallClock, timeZone);
      const end = startOfDayUtc(tomorrowParts.year, tomorrowParts.month, tomorrowParts.day, timeZone);
      return { start, end, timeZone, label: name };
    }
    case "current_month": {
      const start = startOfDayUtc(year, month, 1, timeZone);
      const nextMonth = addMonths(year, month, 1);
      const end = startOfDayUtc(nextMonth.year, nextMonth.month, 1, timeZone);
      return { start, end, timeZone, label: name };
    }
    case "previous_month": {
      const prevMonth = addMonths(year, month, -1);
      const start = startOfDayUtc(prevMonth.year, prevMonth.month, 1, timeZone);
      const end = startOfDayUtc(year, month, 1, timeZone);
      return { start, end, timeZone, label: name };
    }
    case "current_quarter": {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const start = startOfDayUtc(year, quarterStartMonth, 1, timeZone);
      const next = addMonths(year, quarterStartMonth, 3);
      const end = startOfDayUtc(next.year, next.month, 1, timeZone);
      return { start, end, timeZone, label: name };
    }
    case "previous_quarter": {
      const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
      const prev = addMonths(year, quarterStartMonth, -3);
      const start = startOfDayUtc(prev.year, prev.month, 1, timeZone);
      const end = startOfDayUtc(year, quarterStartMonth, 1, timeZone);
      return { start, end, timeZone, label: name };
    }
    case "current_year": {
      const start = startOfDayUtc(year, 1, 1, timeZone);
      const end = startOfDayUtc(year + 1, 1, 1, timeZone);
      return { start, end, timeZone, label: name };
    }
    case "previous_year": {
      const start = startOfDayUtc(year - 1, 1, 1, timeZone);
      const end = startOfDayUtc(year, 1, 1, timeZone);
      return { start, end, timeZone, label: name };
    }
  }
}

/**
 * A caller-supplied custom range — validated (start strictly before end,
 * both real dates) but otherwise trusted as-is. `timeZone` is carried
 * only for DISPLAY purposes here (the boundaries themselves are already
 * concrete instants, not wall-clock dates to re-resolve).
 */
export function customPeriod(start: Date, end: Date, timeZone: string): FinancialPeriod {
  if (!(start.getTime() < end.getTime())) {
    throw new RangeError("A financial period's start must be strictly before its end.");
  }
  return { start, end, timeZone, label: "custom" };
}

/** The immediately-preceding period of the SAME length, ending exactly where `period` begins — what `movement`/trend "compared to last period" needs (never a differently-sized window). */
export function previousPeriodOf(period: FinancialPeriod): FinancialPeriod {
  const durationMs = period.end.getTime() - period.start.getTime();
  return { start: new Date(period.start.getTime() - durationMs), end: period.start, timeZone: period.timeZone, label: "custom" };
}

/** `true` iff `date` falls within `[period.start, period.end)`. The one comparison every report should use — never a hand-rolled `>=`/`<=` pair that risks double-counting a boundary instant in two adjacent periods. */
export function isWithinPeriod(date: Date, period: FinancialPeriod): boolean {
  return date.getTime() >= period.start.getTime() && date.getTime() < period.end.getTime();
}

/** Splits `period` into `count` equal-length buckets — the x-axis for every Module 15 trend chart (spec §9). The LAST bucket's `end` is always exactly `period.end` (no drift from repeated float division). */
export function splitIntoBuckets(period: FinancialPeriod, count: number): FinancialPeriod[] {
  if (count < 1) throw new RangeError("splitIntoBuckets requires count >= 1.");
  const totalMs = period.end.getTime() - period.start.getTime();
  const buckets: FinancialPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(period.start.getTime() + Math.round((totalMs * i) / count));
    const end = i === count - 1 ? period.end : new Date(period.start.getTime() + Math.round((totalMs * (i + 1)) / count));
    buckets.push({ start, end, timeZone: period.timeZone, label: "custom" });
  }
  return buckets;
}
