/**
 * Website Development OS credential/secret-storage guard (Build 32 —
 * Roadmap Module 26 security remediation — Codex Security Engineer
 * finding WDEV-SEC-01). This domain must NEVER persist a customer
 * credential in any free-text field — see docs/architecture/website-
 * development-os.md "Credentials — absolute rule." A field-name
 * allow-list alone is not sufficient (no field in this domain is named
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
const SECRET_LABEL_PATTERN =
  /\b(password|passwd|pwd|secret|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|ssh[\s_-]?key|ssh[\s_-]?password|ftp[\s_-]?password|db(?:atabase)?[\s_-]?password|auth[\s_-]?token|bearer)\s*[:=]/i;

export class SuspectedSecretContentError extends Error {
  constructor(public readonly fieldLabel: string) {
    super(`${fieldLabel} appears to contain a credential or secret. Website Development OS never stores customer credentials — remove it and use a secure credential system instead.`);
    this.name = "SuspectedSecretContentError";
  }
}

/** Throws `SuspectedSecretContentError` if `value` contains a "label: value"/"label=value" pattern matching a known credential label. No-op for null/undefined/empty. */
export function assertNoSecretLikeContent(value: string | null | undefined, fieldLabel: string): void {
  if (!value) return;
  if (SECRET_LABEL_PATTERN.test(value)) throw new SuspectedSecretContentError(fieldLabel);
}
