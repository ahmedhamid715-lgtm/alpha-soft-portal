import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * The one place proposal-authored HTML (`CrmProposalVersion.bodyHtml`/
 * `termsHtml`, `CrmProposalTemplate.defaultBodyHtml`/`defaultTermsHtml`)
 * is sanitized — called server-side, once, before ANY such value is
 * persisted, never trusting the client-side `RichTextFoundation`
 * component's own output as safe on its own (that component's
 * `contentEditable` + `dangerouslySetInnerHTML` combination is
 * explicitly a foundation, not a sanitizer — see its own top comment).
 * Proposal content is real customer-facing business content and is
 * handled as untrusted input regardless of who authored it, matching
 * the master prompt's own explicit instruction — an internal staff
 * account being compromised, or a copy-paste from an untrusted source
 * into the editor, must not become a stored-XSS vector for every future
 * viewer of this proposal (staff previewing it, and eventually an
 * external recipient).
 *
 * A real, maintained sanitization library (`sanitize-html`) — not a
 * hand-rolled regex/allowlist, which is a well-known way to get XSS
 * sanitization subtly wrong. Allowlist matches exactly what
 * `RichTextFoundation`'s own toolbar can produce (bold/italic/lists) plus
 * the handful of structural tags a pasted-in proposal body plausibly
 * needs (paragraphs, line breaks, headings, links, tables) — nothing
 * that can execute script or load an external resource.
 */
const ALLOWED_TAGS = ["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "hr", "span", "div"];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title", "target", "rel"],
  "*": ["style"],
};

export function sanitizeProposalHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // No `javascript:`/`data:` links, no `srcset`-style resource loading —
    // no `img`/`script`/`iframe`/`object`/`embed`/`style` tag anywhere in
    // ALLOWED_TAGS to begin with, and this closes the remaining `href`
    // scheme vector on the one tag that does carry a URL.
    allowedSchemes: ["http", "https", "mailto"],
    // Inline `style` attributes are allowed above (for the rich-text
    // foundation's own formatting output) but restricted to a narrow,
    // non-executable property allowlist — no `expression()`/`url()`
    // vectors.
    allowedStyles: {
      "*": {
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "text-decoration": [/^.*$/],
      },
    },
    disallowedTagsMode: "discard",
  }).trim();
}
