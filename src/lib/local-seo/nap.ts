/**
 * NAP (Name / Address / Phone) normalization and consistency comparison
 * — Build 31, Roadmap Module 25. Pure functions, no I/O. Mirrors
 * `src/lib/organizations/domains.ts`'s own "canonical form, original
 * always preserved" discipline: `LocalSeoLocation`/`LocalListing` both
 * store exactly what was entered/observed — normalization happens ONLY
 * here, at comparison time, and is never persisted (see both models'
 * own doc comments in the migration for why: a stored normalized
 * column risks drifting out of sync with its own source column the
 * moment either is edited independently).
 *
 * Alpha OS has no real postal-address-validation or geocoding
 * capability — normalization here is syntactic only (whitespace/case/
 * punctuation), never a claim of deliverability or a fabricated
 * canonical address.
 */

/** Lowercase, collapse whitespace, trim, strip common punctuation that never carries comparison meaning for a business name (periods, commas, apostrophes). */
export function normalizeBusinessName(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Digits only — deliberately does NOT claim E.164 validity (no real
 * country-context validation exists). One narrow, documented exception:
 * an 11-digit sequence starting with "1" (the common NANP/+1 country-
 * code prefix for US/Canada numbers) is normalized to its 10-digit
 * form, so "+1 212-555-0100" and "(212) 555-0100" — the single most
 * common real-world entry variance this codebase will actually see —
 * compare equal. This is NOT a claim of general E.164 validation; a
 * business outside the NANP never has this prefix stripped.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/** Lowercase, collapse whitespace, trim, strip common punctuation — combines line1/city/postalCode into one comparable string (the fields most likely to appear, in some form, on any real external listing). Never geocodes, never claims postal validity. */
export function normalizeAddress(line1: string | null | undefined, city: string | null | undefined, postalCode: string | null | undefined): string | null {
  const parts = [line1, city, postalCode].filter((p): p is string => Boolean(p && p.trim().length > 0));
  if (parts.length === 0) return null;
  return parts
    .join(" ")
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type NapConsistencyStatus = "CONSISTENT" | "INCONSISTENT" | "PARTIAL" | "NOT_MEASURABLE";

export interface NapCanonical {
  businessName: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface NapObserved {
  observedBusinessName: string | null;
  observedAddressLine1: string | null;
  observedCity: string | null;
  observedPostalCode: string | null;
  observedPhone: string | null;
}

type FieldOutcome = "MATCH" | "MISMATCH" | "UNAVAILABLE";

/**
 * Frozen formula (Build 31). Compares three independent fields — name,
 * address (line1+city+postalCode combined), phone — each field is
 * `UNAVAILABLE` when EITHER side lacks a normalizable value for it
 * (never treated as a match OR a mismatch), `MATCH`/`MISMATCH`
 * otherwise.
 *
 *   - all 3 UNAVAILABLE                      -> NOT_MEASURABLE (nothing to compare)
 *   - 0 MISMATCH, 0 MATCH (impossible given above, kept for clarity)
 *   - any MISMATCH                            -> INCONSISTENT
 *   - 0 MISMATCH, at least 1 MATCH + 1 UNAVAILABLE -> PARTIAL
 *   - all comparable fields MATCH (0 MISMATCH, 0 UNAVAILABLE)  -> CONSISTENT
 *
 * A listing is never called INCONSISTENT merely because an optional
 * field is absent — only a genuine MISMATCH does that.
 */
export function evaluateNapConsistency(canonical: NapCanonical, observed: NapObserved): NapConsistencyStatus {
  const fields: FieldOutcome[] = [
    compareField(normalizeBusinessName(canonical.businessName), normalizeBusinessName(observed.observedBusinessName)),
    compareField(normalizeAddress(canonical.addressLine1, canonical.city, canonical.postalCode), normalizeAddress(observed.observedAddressLine1, observed.observedCity, observed.observedPostalCode)),
    compareField(normalizePhone(canonical.phone), normalizePhone(observed.observedPhone)),
  ];

  if (fields.every((f) => f === "UNAVAILABLE")) return "NOT_MEASURABLE";
  if (fields.some((f) => f === "MISMATCH")) return "INCONSISTENT";
  if (fields.some((f) => f === "UNAVAILABLE")) return "PARTIAL";
  return "CONSISTENT";
}

function compareField(a: string | null, b: string | null): FieldOutcome {
  if (a === null || b === null) return "UNAVAILABLE";
  return a === b ? "MATCH" : "MISMATCH";
}
