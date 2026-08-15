/**
 * Date/time conventions (spec section 29).
 *
 *   - Every timestamp is stored and passed between server and database in
 *     UTC. Future Prisma `DateTime` fields must use `@db.Timestamptz(3)`
 *     (timezone-aware column type), never bare `timestamp` — see
 *     docs/architecture/database.md.
 *   - Conversion to a user's or organization's timezone happens only at
 *     the presentation boundary (a page, an email, a PDF report), via
 *     `formatInTimeZone` below — never scattered through business logic.
 *   - Per-user/per-organization timezone becomes configurable once Module
 *     06 (Organizations) exists; `config/app.ts`'s `defaults.timezone` is
 *     the fallback until then.
 *
 * No date library dependency (date-fns, luxon, dayjs, ...) — the native
 * `Intl.DateTimeFormat` API covers everything Module 01 needs
 * (timezone-aware formatting) without adding a dependency whose only job
 * would be wrapping that same API.
 */

export function nowUtc(): Date {
  return new Date();
}

export function toIsoUtc(date: Date): string {
  return date.toISOString();
}

/**
 * Format a UTC `Date` as wall-clock time in `timeZone` (an IANA zone name,
 * e.g. `"America/New_York"`). This is the ONLY place timezone conversion
 * should happen — call it at render time, not when storing or passing
 * data between server functions.
 */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(date);
}

/** True if `zone` is a real IANA timezone identifier (`Intl` will throw on garbage input). */
export function isValidTimeZone(zone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
