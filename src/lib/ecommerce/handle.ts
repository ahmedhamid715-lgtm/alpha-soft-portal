/**
 * `EcommerceProduct`/`EcommerceCollection` handle semantics (Build 33 —
 * Roadmap Module 27). A handle is the catalog-item's own URL-safe slug
 * identity within a store — lowercase, ASCII alphanumeric + hyphen only,
 * no leading/trailing/consecutive hyphens. Deliberately simpler than
 * Website Dev's own `normalizeWebsitePagePath()` (a handle is one path
 * SEGMENT, never a full site-relative path — no leading `/`, no nested
 * segments) — a genuinely different concept, not a copy.
 */

const VALID_HANDLE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class InvalidEcommerceHandleError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`"${input}" is not a valid handle: ${reason}`);
    this.name = "InvalidEcommerceHandleError";
  }
}

/** Normalizes to lowercase, trimmed. Rejects anything outside the allowed charset/shape rather than silently rewriting it — an explicit typo should surface, not be guessed away (same discipline as `normalizeWebsitePagePath()`). */
export function normalizeEcommerceHandle(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) throw new InvalidEcommerceHandleError(input, "empty");
  if (trimmed.length > 200) throw new InvalidEcommerceHandleError(input, "must be 200 characters or fewer");
  if (!VALID_HANDLE_PATTERN.test(trimmed)) {
    throw new InvalidEcommerceHandleError(input, "must contain only lowercase letters, digits, and single hyphens between words (no leading/trailing/consecutive hyphens)");
  }
  return trimmed;
}
