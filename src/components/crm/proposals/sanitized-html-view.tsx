/**
 * Renders proposal-authored HTML that was ALREADY sanitized server-side
 * before storage (`sanitizeProposalHtml()`, called from every write path
 * in `crm-proposal-service.ts`/`crm-proposal-template-service.ts` —
 * never raw client input reaching this component). This is the one
 * place in the CRM proposal surface `dangerouslySetInnerHTML` is used,
 * and it's safe specifically because the trust boundary is at WRITE
 * time, not read time — matching the master prompt's own instruction
 * that raw `dangerouslySetInnerHTML` is only acceptable with an
 * existing trusted sanitizer in the loop.
 */
export function SanitizedHtmlView({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
