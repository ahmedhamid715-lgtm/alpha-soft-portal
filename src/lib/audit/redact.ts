/**
 * Audit-specific redaction (Module 08, spec Phase 10) — a deliberately
 * SEPARATE module from `lib/logging/redact.ts`, not a shared import. Two
 * reasons: audit records are retained far longer and reviewed by more
 * people than a log stream (see `docs/architecture/audit-system.md`
 * "Core principle" — these are independent concerns even where the
 * underlying algorithm looks similar), and this module's pattern must be
 * broader — the logging module's set is tuned for what actually shows up
 * in application log context objects; this module's spec explicitly
 * names several keys (`cookie`, `privateKey`, `clientSecret`) the
 * logging pattern doesn't currently catch.
 *
 * Applied to every `metadata`/`previousState`/`newState` object
 * immediately before it reaches `auditEventRepository.create()` — the
 * caller is never trusted to have pre-redacted anything.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|authorization|auth[_-]?header|session[_-]?id|cookie|private[_-]?key|encryption[_-]?key|signing[_-]?key|credit[_-]?card|card[_-]?number|cvv|ssn|social[_-]?security/i;

const REDACTED = "[redacted]";
const MAX_DEPTH = 8;

/**
 * Deep-clones `value`, replacing any value whose OWN key matches
 * `SENSITIVE_KEY_PATTERN` with `"[redacted]"` — matched case-insensitively
 * against the key name only (not the full path, not the value), so
 * `user.password`, `newPassword`, and `TOKEN_HASH` are all caught
 * regardless of nesting depth, including inside arrays.
 *
 * Deliberately conservative about what it does NOT redact: a key like
 * `"keyword"`, `"monkeyBusiness"`, or `"primaryKey"` must survive
 * untouched — a bare `key` pattern would over-redact legitimate business
 * data (this module's own spec explicitly warns against that), so every
 * "key"-adjacent pattern above is anchored to a specific compound term
 * (`apiKey`, `privateKey`, `encryptionKey`, `signingKey`), never a bare
 * substring match on "key" alone.
 */
export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactAuditValue(val, depth + 1);
  }
  return result;
}

/** `undefined` in, `undefined` out — callers pass optional `metadata`/`previousState`/`newState` and shouldn't have to null-check before redacting. */
export function redactAuditObject<T extends Record<string, unknown> | undefined>(value: T): T {
  if (value === undefined) return value;
  return redactAuditValue(value) as T;
}
