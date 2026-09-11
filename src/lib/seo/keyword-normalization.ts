/**
 * Keyword phrase normalization — Build 30, Roadmap Module 24. Prevents
 * the master prompt's own explicitly-named failure mode: "Avoid
 * duplicate keywords caused only by casing/whitespace where the
 * business considers them equivalent." Pure, no I/O.
 *
 * Canonical form: trimmed, internal whitespace collapsed to a single
 * space, lowercased. The ORIGINAL `phrase` (as entered) is always
 * preserved separately for display — only `normalizedPhrase` is used
 * for the dedup/uniqueness dimension.
 */
export function normalizeKeywordPhrase(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}
