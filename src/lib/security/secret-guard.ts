/**
 * Cross-domain credential/secret-storage guard (Build 32 — Website
 * Development OS security remediation, Codex Security Engineer finding
 * WDEV-SEC-01 — promoted to a shared, domain-neutral location in Build
 * 33 so E-Commerce Development can reuse it directly rather than
 * duplicating it or depending on Website Dev's own lib namespace). Any
 * domain that persists customer/merchant free-text fields must NEVER
 * become a credential-storage path. A field-name allow-list alone is
 * not sufficient (no field in either domain is literally named
 * "password"), so every persisted free-text value that could plausibly
 * carry a pasted credential is screened for a credential-shaped
 * substring before it ever reaches the database or an audit record.
 *
 * This is a content-based heuristic, not a cryptographic guarantee — it
 * exists to fail loudly on the realistic mistake (a staff member pasting
 * "FTP password: hunter2" into a notes field, or "API key: sk_live_...")
 * rather than to detect every conceivable secret encoding. It
 * deliberately requires a recognizable label immediately followed by
 * `:`/`=` so it does not reject ordinary prose that merely mentions the
 * word "token" or "key" in passing (e.g. "uses an API key for
 * analytics" is allowed; "API key: sk_live_abc123" is not).
 */
/**
 * Build 33 Codex Security Engineer finding (ECOM-SEC-01) — the original
 * pattern only recognized `auth[\s_-]?token`/`bearer` as token-shaped
 * labels, so a plain "access token: shpat_..." or "refresh token=..."
 * (no `auth`/`bearer` prefix) passed through unscreened. Fixed by adding
 * a bare `token`/`credential` alternative (catches any spaced/hyphenated
 * "<anything> token:"/"<anything> credential:" label) PLUS explicit
 * `access[\s_-]?token`/`refresh[\s_-]?token`/`shopify[\s_-]?token`/
 * `woocommerce[\s_-]?secret` compounds for the camelCase-glued form
 * (`accessToken:`) where `\b` cannot find a boundary between "access"
 * and "Token" — the bare-word alternative alone would miss that case.
 */
const SECRET_LABEL_PATTERN =
  /\b(password|passwd|pwd|secret|credential|token|api[\s_-]?key|access[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|shopify[\s_-]?token|woocommerce[\s_-]?secret|private[\s_-]?key|ssh[\s_-]?key|ssh[\s_-]?password|ftp[\s_-]?password|db(?:atabase)?[\s_-]?password|consumer[\s_-]?secret|webhook[\s_-]?secret|auth[\s_-]?token|bearer)\s*[:=]/i;

export class SuspectedSecretContentError extends Error {
  constructor(public readonly fieldLabel: string) {
    super(`${fieldLabel} appears to contain a credential or secret. This domain never stores customer/merchant credentials — remove it and use a secure credential system instead.`);
    this.name = "SuspectedSecretContentError";
  }
}

/** Throws `SuspectedSecretContentError` if `value` contains a "label: value"/"label=value" pattern matching a known credential label. No-op for null/undefined/empty. */
export function assertNoSecretLikeContent(value: string | null | undefined, fieldLabel: string): void {
  if (!value) return;
  if (SECRET_LABEL_PATTERN.test(value)) throw new SuspectedSecretContentError(fieldLabel);
}
