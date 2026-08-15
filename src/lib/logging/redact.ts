/**
 * Keys whose values must never reach a log line, regardless of how deeply
 * nested they are in a context/metadata object. Matched case-insensitively
 * against the key name — not the full path — so `user.password`,
 * `newPassword`, and `PASSWORD_HASH` are all caught.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|authorization|auth[_-]?header|session[_-]?id|credit[_-]?card|ssn|social[_-]?security/i;

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

/**
 * Deep-clones `value`, replacing any value whose key matches
 * `SENSITIVE_KEY_PATTERN` with `"[redacted]"`. Used by every logger
 * implementation before a context object is serialized — see
 * docs/architecture/logging.md for the full list of what must never be
 * logged and why this exists as a shared function instead of per-call-site
 * discipline.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
  }
  return result;
}
