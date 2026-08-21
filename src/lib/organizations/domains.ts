/**
 * Domain normalization/validation for `OrganizationInvitationPolicy`'s
 * `allowedDomains`/`blockedDomains` (Module 12, spec's own "domain
 * validation" section). Pure functions, no I/O — unit-tested directly.
 *
 * ## Canonical form
 *
 * A bare, lowercase, ASCII hostname — `"example.com"`. Never:
 *
 * - A full email address (`"user@example.com"`) — this is a DOMAIN
 *   list, not an email list; the invitation's own `email` field is
 *   compared AGAINST a domain from this list, never the other way
 *   around.
 * - A URL/protocol prefix (`"https://example.com"`) or a path
 *   (`"example.com/careers"`) — a domain has neither.
 * - Mixed case (`"Example.COM"`) — DNS hostnames are case-insensitive;
 *   storing the canonical lowercase form is what makes two
 *   administrators independently typing "Example.com" and "example.COM"
 *   collapse into the exact same policy entry, not two.
 *
 * ## Subdomains — NOT included by default
 *
 * `"example.com"` in the list matches an invitation to
 * `user@example.com` only — NOT `user@mail.example.com`. This is a
 * deliberate, documented choice (spec's own "define whether subdomains
 * are included... do not create ambiguous matching behavior"): an
 * implicit subdomain match is a common source of real security bugs
 * (an org allow-lists `example.com` intending to trust ONLY their own
 * corporate domain, and a `evil.example.com` — registerable by anyone
 * who controls a wildcard DNS zone the org doesn't actually own end to
 * end — would silently pass). An explicit wildcard syntax
 * (`"*.example.com"`) is deliberately NOT supported either — spec's own
 * "reject malformed wildcard syntax" instruction, read as "don't
 * introduce wildcard matching this module doesn't have a real, tested
 * need for yet" rather than "half-support it." An organization that
 * genuinely needs a subdomain matched lists it explicitly
 * (`"mail.example.com"`) — one domain, one list entry, one obvious
 * behavior.
 */

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export class InvalidDomainError extends Error {
  constructor(public readonly input: string, public readonly reason: string) {
    super(`"${input}" is not a valid domain: ${reason}`);
    this.name = "InvalidDomainError";
  }
}

/**
 * Normalizes one domain to canonical form, or throws `InvalidDomainError`
 * with a specific, safe-to-display reason. Never silently "fixes" an
 * ambiguous input (a full email, a URL) — those are rejected outright,
 * not reinterpreted, so a typo never silently becomes a different,
 * unintended policy.
 */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidDomainError(input, "empty");
  }
  if (trimmed.includes("@")) {
    throw new InvalidDomainError(input, "looks like a full email address, not a domain");
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    throw new InvalidDomainError(input, "must not include a protocol (e.g. \"https://\")");
  }
  if (trimmed.includes("/")) {
    throw new InvalidDomainError(input, "must not include a path");
  }
  if (trimmed.includes("*")) {
    throw new InvalidDomainError(input, "wildcard syntax is not supported — list the exact (sub)domain instead");
  }

  const lower = trimmed.toLowerCase();
  if (!DOMAIN_PATTERN.test(lower)) {
    throw new InvalidDomainError(input, "not a valid domain (letters, digits, hyphens, at least one dot)");
  }
  return lower;
}

/**
 * Normalizes a whole list — dedupes (two entries that normalize to the
 * same canonical domain collapse to one, silently; a user typing the
 * same domain twice is not an error worth surfacing) and preserves
 * first-seen order. Throws on the FIRST invalid entry — `updateInvitationPolicy()`
 * (the one real caller) surfaces that as a single, specific field error,
 * not a partial success with some domains silently dropped.
 */
export function normalizeDomainList(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of inputs) {
    const domain = normalizeDomain(raw);
    if (!seen.has(domain)) {
      seen.add(domain);
      result.push(domain);
    }
  }
  return result;
}

/** Bare-domain match only — see this file's own top comment for why subdomains are never implicitly included. */
export function emailMatchesDomain(email: string, domain: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return email.slice(at + 1).toLowerCase() === domain;
}
