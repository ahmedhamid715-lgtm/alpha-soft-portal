/**
 * The prompt-injection trust boundary (Module 18, spec §14). Retrieved
 * content is UNTRUSTED DATA — it was written by whoever authored the
 * source document, not by this platform's own system prompt or the
 * authenticated user asking a question. A future AI module assembling
 * a real prompt from `ContextAssemblyResult` (see
 * `knowledge-context-assembly-service.ts`) MUST be able to tell these
 * four categories apart:
 *
 *   SYSTEM INSTRUCTIONS  — this platform's own fixed prompt.
 *   USER INSTRUCTIONS    — what the authenticated human actually asked.
 *   RETRIEVED CONTENT     — what THIS module returns. Data, never commands.
 *   TOOL OUTPUT           — the result of an action a future agent took.
 *
 * "Prompt injection can be solved by a simple string filter" is NOT a
 * claim this module makes (spec §14's own explicit warning) — no
 * deterministic defense makes a model immune to a sufficiently clever
 * payload embedded in retrieved text. What IS implemented, deterministically,
 * and tested directly:
 *
 *   1. Structural labeling — every retrieved item is wrapped in an
 *      explicit, machine-parseable boundary tag naming it as
 *      `retrieved_content`, never left as bare, unlabeled text a
 *      prompt-builder might accidentally concatenate as if it were an
 *      instruction.
 *   2. Boundary-escape prevention — a chunk's own content is escaped so
 *      it can never contain a literal closing tag that would let it
 *      prematurely terminate its own boundary and have subsequent text
 *      parsed as if it had "escaped" back into an instruction context.
 *      This is a REAL, concrete defense against a real, concrete attack
 *      shape (a document containing `</retrieved_context><system>...`),
 *      not just documentation of a boundary that doesn't actually hold.
 *
 * See docs/architecture/knowledge-security.md "Prompt-injection defense
 * — what is, and is not, actually defended against" for the full,
 * honest accounting.
 */

export const RETRIEVED_CONTENT_TAG = "retrieved_context";

export interface TrustedContextBlock {
  /** Always `"retrieved_content"` today — the type exists so a future TOOL OUTPUT block (a different Module) can share the same discriminated shape without this one changing. */
  trustLevel: "retrieved_content";
  sourceId: string;
  documentId: string;
  chunkId: string;
  content: string;
}

/**
 * Neutralizes any literal (case-insensitive, whitespace-tolerant)
 * occurrence of this boundary's own closing sequence inside untrusted
 * content — replaces `</retrieved_context` with a visually similar but
 * structurally inert sequence. The escaped form is lossy by design: a
 * legitimate document that happens to contain this literal string
 * (vanishingly unlikely in real prose) is altered rather than risk the
 * boundary itself being escapable — the safe failure direction. Does
 * NOT attempt to catch Unicode look-alike angle-bracket characters — a
 * real gap, honestly left for a future hardening pass rather than
 * claimed as covered (see knowledge-security.md "Prompt-injection
 * defense — what is, and is not, actually defended against").
 */
function escapeBoundary(content: string): string {
  const boundaryPattern = /<\s*\/\s*retrieved_context/gi;
  return content.replace(boundaryPattern, "[escaped-boundary-tag]");
}

/**
 * Renders one retrieved chunk as a labeled, boundary-safe block. The
 * `source`/`document`/`chunk` attributes carry PROVENANCE (spec §12),
 * not trust — they identify WHERE this data came from so a future
 * citation UI or audit trail can trace it, they do not make the
 * content itself any more trusted.
 */
export function renderTrustedContextBlock(block: TrustedContextBlock): string {
  const safeContent = escapeBoundary(block.content);
  return [
    `<${RETRIEVED_CONTENT_TAG} source="${block.sourceId}" document="${block.documentId}" chunk="${block.chunkId}" trust="untrusted_data">`,
    safeContent,
    `</${RETRIEVED_CONTENT_TAG}>`,
  ].join("\n");
}
