/**
 * SEO property (website) identity normalization — Build 30, Roadmap
 * Module 24. Mirrors `src/lib/organizations/domains.ts`'s own "pure,
 * explicit-rejection-reason, never silently reinterpreted" discipline,
 * but for a full property origin rather than a bare domain: an SEO
 * property is identified by WHERE it is served from (scheme + host),
 * never by a path, since rank tracking/technical audits operate at the
 * site level.
 *
 * ## Canonical form
 *
 * `normalizedOrigin` = `"<scheme>://<lowercase-host>"` — e.g.
 * `"https://example.com"`. Uses the real WHATWG `URL` parser (never a
 * hand-rolled regex) so genuinely malformed input is rejected outright
 * rather than partially parsed.
 *
 * ## www / non-www and http / https are DIFFERENT properties — by design
 *
 * `"https://example.com"` and `"https://www.example.com"` are NOT
 * silently merged into one property, and neither are `"http://"` vs
 * `"https://"` variants. This is a deliberate SEO-domain decision, not
 * an oversight: whether a site's canonical URLs use `www` or not (and
 * whether it correctly redirects the other form) is itself a real
 * technical-SEO concern — collapsing them here would hide exactly the
 * kind of misconfiguration this module exists to surface. A property
 * that legitimately serves the same site on both forms should be
 * tracked as two properties (or one, if staff deliberately choose to
 * track only the canonical form) — never decided implicitly.
 *
 * ## What's rejected
 *
 * Only `http:`/`https:` schemes are accepted. A path/query/fragment on
 * the entered URL is accepted (real users paste a homepage URL with a
 * trailing slash, or occasionally a full URL) but is DROPPED from the
 * canonical identity — only `displayUrl` (the caller's original input,
 * stored separately) preserves it. Default ports (`:80` for http,
 * `:443` for https) are stripped since they're semantically identical
 * to no port at all; a non-default port is preserved (a real, distinct
 * property).
 */

export class InvalidPropertyUrlError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`"${input}" is not a valid property URL: ${reason}`);
    this.name = "InvalidPropertyUrlError";
  }
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

export interface NormalizedPropertyUrl {
  /** Canonical identity — scheme + lowercase host (+ non-default port). No path/query/fragment. */
  normalizedOrigin: string;
  /** The caller's original input, trimmed only — never rewritten. */
  displayUrl: string;
}

/**
 * Throws `InvalidPropertyUrlError` with a specific, safe-to-display
 * reason rather than silently coercing an ambiguous input. Never
 * infers a scheme for a bare host (`"example.com"` is rejected, not
 * quietly upgraded to `"https://example.com"`) — an explicit scheme is
 * required so staff can deliberately track an `http://`-only legacy
 * property if that's the real, current state of the site.
 */
export function normalizePropertyUrl(input: string): NormalizedPropertyUrl {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidPropertyUrlError(input, "empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidPropertyUrlError(input, "not a well-formed URL — include a scheme, e.g. \"https://example.com\"");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidPropertyUrlError(input, `unsupported scheme "${parsed.protocol}" — only http:// and https:// are supported`);
  }
  if (parsed.hostname.length === 0) {
    throw new InvalidPropertyUrlError(input, "missing host");
  }

  const host = parsed.hostname.toLowerCase();
  const isDefaultPort = parsed.port === "" || parsed.port === DEFAULT_PORTS[parsed.protocol];
  const authority = isDefaultPort ? host : `${host}:${parsed.port}`;

  return { normalizedOrigin: `${parsed.protocol}//${authority}`, displayUrl: trimmed };
}

/**
 * Same-origin check against an already-normalized property, for
 * validating a keyword's/issue's own `targetUrl`/`pageUrl` genuinely
 * belongs to the property it's attached to (not a cross-site URL
 * slipped in through a forged/careless input). A page URL keeps its
 * full path — only the origin portion is compared.
 */
export function urlBelongsToOrigin(url: string, normalizedOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isDefaultPort = parsed.port === "" || parsed.port === DEFAULT_PORTS[parsed.protocol];
    const authority = isDefaultPort ? host : `${host}:${parsed.port}`;
    return `${parsed.protocol}//${authority}` === normalizedOrigin;
  } catch {
    return false;
  }
}
