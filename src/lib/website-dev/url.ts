/**
 * Website Development OS URL identity (Build 32 — Roadmap Module 26).
 * Uses the real WHATWG `URL` parser (never a hand-rolled regex), same
 * discipline `src/lib/seo/property-url.ts` already established — but a
 * DELIBERATELY DIFFERENT canonicalization rule, frozen fresh for this
 * domain rather than blindly inherited from SEO OS.
 *
 * ## Why this rule differs from SEO OS's own
 *
 * SEO OS keeps `www.example.com` and `example.com` as two genuinely
 * DISTINCT tracked properties — whether a site correctly canonicalizes
 * one form to the other is itself the technical-SEO fact being
 * measured, so silently merging them would hide exactly what that
 * module exists to catch.
 *
 * Website Development OS measures something different: WHICH real
 * website is being built/delivered, an operational identity question,
 * not a ranking-measurement one. A customer's site is the same site
 * whether staff type `https://example.com` or `https://www.example.com`
 * — treating them as two different `WebsiteSite` rows would be a data
 * hygiene bug, not a useful distinction. So `normalizedOrigin` here
 * strips a leading `www.` label before comparison. The original entered
 * URL is still always preserved verbatim as the display value — this
 * normalization exists ONLY for dedup/identity comparison, exactly like
 * every other normalize-for-comparison utility in this codebase.
 */

export class InvalidWebsiteUrlError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: string,
  ) {
    super(`"${input}" is not a valid website URL: ${reason}`);
    this.name = "InvalidWebsiteUrlError";
  }
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

export interface NormalizedWebsiteUrl {
  /** Canonical identity for dedup/comparison — scheme + lowercase host with a leading "www." stripped (+ non-default port). */
  normalizedOrigin: string;
  /** The caller's original input, trimmed only — never rewritten. */
  displayUrl: string;
}

/** Only `http:`/`https:` are accepted — never `javascript:`/`data:`/`file:`/any other scheme. A bare host with no scheme is rejected, not guessed. */
export function normalizeWebsiteUrl(input: string): NormalizedWebsiteUrl {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidWebsiteUrlError(input, "empty");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidWebsiteUrlError(input, 'not a well-formed URL — include a scheme, e.g. "https://example.com"');
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidWebsiteUrlError(input, `unsupported scheme "${parsed.protocol}" — only http:// and https:// are supported`);
  }
  if (parsed.hostname.length === 0) throw new InvalidWebsiteUrlError(input, "missing host");
  // WDEV-SEC-01 (Codex Security Engineer, Build 32) — WHATWG URL userinfo
  // (`https://user:password@host`) is a real, common credential-storage
  // path this domain must never accept — Website Development OS never
  // stores customer credentials, and a URL is not exempt from that rule
  // merely because the secret is embedded in its authority component.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new InvalidWebsiteUrlError(input, "must not include a username/password — Website Development OS never stores credentials, including ones embedded in a URL");
  }

  const lowerHost = parsed.hostname.toLowerCase();
  const host = lowerHost.startsWith("www.") ? lowerHost.slice(4) : lowerHost;
  const isDefaultPort = parsed.port === "" || parsed.port === DEFAULT_PORTS[parsed.protocol];
  const authority = isDefaultPort ? host : `${host}:${parsed.port}`;

  return { normalizedOrigin: `${parsed.protocol}//${authority}`, displayUrl: trimmed };
}

/** `true` only for `http:`/`https:` with no embedded userinfo — used wherever a URL is accepted but full normalization/identity isn't needed (e.g. a repository-reference URL). Same WDEV-SEC-01 credential-storage rule as `normalizeWebsiteUrl()`. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username !== "" || parsed.password !== "") return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
