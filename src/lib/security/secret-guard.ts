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
/**
 * Build 34 Codex Security Engineer finding (GHL-SEC-01) — the label-only
 * pattern above requires a recognizable label immediately before `:`/`=`,
 * so it still passed two real classes of pasted credential:
 *   1. A glued label this domain specifically needs (`pitToken=...` — a
 *      GoHighLevel Private Integration Token) that wasn't in the label
 *      list at all. Fixed by adding `pit[\s_-]?token`, matching the same
 *      camelCase-glue-tolerant compound style as `access[\s_-]?token`.
 *   2. An UNLABELED value in one of a handful of real, high-specificity
 *      provider credential formats (a bare `sk_live_...` with no
 *      "key:"/"secret:" prefix at all, a Twilio Account SID, a Mailgun
 *      API key, a bare `whsec_...` webhook signing secret). No label
 *      requirement can catch these — the value's own shape IS the
 *      signal, which is also why these specific formats have a low
 *      false-positive rate (they don't collide with ordinary prose the
 *      way a bare word like "token" would). Checked as a SEPARATE
 *      pattern from the label pattern, matched anywhere in the string —
 *      this also means an unlabeled secret pasted into a URL query
 *      string (e.g. `?pitToken=` already caught by the label pattern
 *      above, or `...&stripe_key=sk_live_...`) is still caught even
 *      though the guard has no URL-aware parsing of its own.
 */
const SECRET_LABEL_PATTERN =
  /\b(password|passwd|pwd|secret|credential|token|api[\s_-]?key|access[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|shopify[\s_-]?token|woocommerce[\s_-]?secret|pit[\s_-]?token|private[\s_-]?key|ssh[\s_-]?key|ssh[\s_-]?password|ftp[\s_-]?password|db(?:atabase)?[\s_-]?password|consumer[\s_-]?secret|webhook[\s_-]?secret|auth[\s_-]?token|bearer)\s*[:=]/i;

const SECRET_SIGNATURE_PATTERN =
  /\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}\b|\bwhsec_[A-Za-z0-9]{8,}\b|\bAC[a-f0-9]{32}\b|\bkey-[a-f0-9]{32}\b/i;

export class SuspectedSecretContentError extends Error {
  constructor(public readonly fieldLabel: string) {
    super(`${fieldLabel} appears to contain a credential or secret. This domain never stores customer/merchant credentials — remove it and use a secure credential system instead.`);
    this.name = "SuspectedSecretContentError";
  }
}

/**
 * Throws `SuspectedSecretContentError` if `value` contains either (a) a
 * "label: value"/"label=value" pattern matching a known credential
 * label, or (b) an unlabeled value matching a known high-specificity
 * provider credential SHAPE (Stripe secret/restricted key, Twilio
 * Account SID, Mailgun API key, webhook signing secret). No-op for
 * null/undefined/empty.
 */
export function assertNoSecretLikeContent(value: string | null | undefined, fieldLabel: string): void {
  if (!value) return;
  if (SECRET_LABEL_PATTERN.test(value) || SECRET_SIGNATURE_PATTERN.test(value)) throw new SuspectedSecretContentError(fieldLabel);
}
