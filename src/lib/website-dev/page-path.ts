/**
 * `WebsitePage.path` canonical semantics (Build 32 — Roadmap Module 26).
 * A path is the site-relative route a page/template is delivered at —
 * `/`, `/about`, `/services/seo`. Deliberately simple: no query string,
 * no fragment, no host (that's the site's own `primaryUrl`'s job), no
 * trailing slash except for the root path itself.
 */

const VALID_PATH_PATTERN = /^\/[a-zA-Z0-9\-._~/]*$/;

export class InvalidWebsitePagePathError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`"${input}" is not a valid page path: ${reason}`);
    this.name = "InvalidWebsitePagePathError";
  }
}

/**
 * Normalizes to a canonical form: trimmed, must start with `/`, no
 * trailing slash unless it's the root path, no `//` collapsing needed
 * (rejected outright as invalid rather than silently collapsed — an
 * explicit typo should surface, not be guessed away).
 */
export function normalizeWebsitePagePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidWebsitePagePathError(input, "empty");
  if (!trimmed.startsWith("/")) throw new InvalidWebsitePagePathError(input, 'must start with "/"');
  if (trimmed.includes("?") || trimmed.includes("#")) throw new InvalidWebsitePagePathError(input, "must not include a query string or fragment — record the path only");
  if (trimmed.includes("//")) throw new InvalidWebsitePagePathError(input, "must not contain consecutive slashes");
  if (!VALID_PATH_PATTERN.test(trimmed)) throw new InvalidWebsitePagePathError(input, "contains characters outside the allowed set (letters, digits, - _ . ~ /)");
  // WDEV-SEC-04 (Codex Security Engineer, Build 32) — a literal "."/".."
  // path segment (e.g. "/../admin", "/a/../b") passed every earlier
  // check (the allowed character set includes "." for legitimate file-
  // extension-like segments) but violates the frozen canonical-path
  // contract and could create ambiguous, normalized-equivalent routes.
  // Reject any segment that is exactly "." or "..", never guess/collapse.
  if (trimmed.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new InvalidWebsitePagePathError(input, 'must not contain a "." or ".." path segment');
  }
  const normalized = trimmed.length > 1 && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  if (normalized.length > 500) throw new InvalidWebsitePagePathError(input, "must be 500 characters or fewer");
  return normalized;
}
