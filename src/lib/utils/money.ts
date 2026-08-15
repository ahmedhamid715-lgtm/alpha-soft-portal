/**
 * Money conventions (spec section 30): every monetary value is stored and
 * computed as an **integer number of minor units** (cents, for USD) —
 * never as a JavaScript floating-point number of major units. `0.1 + 0.2
 * !== 0.3` in floating point; a billing system cannot afford that class of
 * bug. Future Prisma models storing money must use an `Int` (or `BigInt`
 * for very large sums) column holding minor units, not `Float`/`Decimal`
 * major-unit amounts — see docs/architecture/database.md.
 *
 * The only place a major-unit decimal number should exist is transiently,
 * at the two boundaries where a human reads or types one: parsing form
 * input (`toMinorUnits`) and formatting for display (`formatMoney`).
 * Everything in between — storage, arithmetic, comparisons — stays in
 * integer minor units.
 */

/** ISO 4217 currencies with zero decimal places (their "minor unit" is the whole unit). */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD", "UGX"]);
/** ISO 4217 currencies with three decimal places. */
const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"]);

export function getCurrencyExponent(currencyCode: string): number {
  const code = currencyCode.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/**
 * Convert a human-entered major-unit amount (e.g. `19.99`) to integer
 * minor units (e.g. `1999`). This is the ONLY point where a float is
 * allowed to represent money — call it once, at input parsing, then
 * discard the float.
 */
export function toMinorUnits(majorUnitAmount: number, currencyCode: string): number {
  const exponent = getCurrencyExponent(currencyCode);
  // Round (not truncate) to the nearest minor unit to absorb the float
  // representation error inherent in `majorUnitAmount` itself.
  return Math.round(majorUnitAmount * 10 ** exponent);
}

/** For display only — do not feed the result back into further arithmetic. */
export function fromMinorUnits(minorUnits: number, currencyCode: string): number {
  const exponent = getCurrencyExponent(currencyCode);
  return minorUnits / 10 ** exponent;
}

export function formatMoney(minorUnits: number, currencyCode: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(fromMinorUnits(minorUnits, currencyCode));
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine amounts in different currencies: ${a} and ${b}.`);
    this.name = "CurrencyMismatchError";
  }
}

/** Integer addition of two minor-unit amounts. Throws if the currencies differ. */
export function addMoney(
  a: { minorUnits: number; currency: string },
  b: { minorUnits: number; currency: string },
): { minorUnits: number; currency: string } {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
  return { minorUnits: a.minorUnits + b.minorUnits, currency: a.currency };
}
