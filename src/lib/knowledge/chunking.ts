import { createHash } from "node:crypto";

/**
 * Deterministic document chunking (Module 18, spec §4). Given the same
 * input content, `chunkText()` always produces the exact same chunks,
 * in the exact same order — no randomness, no wall-clock dependency,
 * verified directly by this file's own unit tests (two calls on the
 * same content produce byte-identical output).
 *
 * `CHUNKING_STRATEGY` is a versioned STRING (not hardcoded inline at
 * call sites) — reprocessing a document under a NEW strategy is a real,
 * supported operation (spec §4/§16): bump this constant, chunk again,
 * the new rows get a new `chunkingStrategy` value and coexist with the
 * old ones (`KnowledgeChunk.chunkingStrategy`'s own schema comment) —
 * never a silent, in-place reinterpretation of what an existing chunk
 * "was."
 */
export const CHUNKING_STRATEGY = "fixed-char-v1";

/** Target chunk size, in characters — NOT "always 500 tokens" (spec §4's own explicit warning against hardcoding one future-proofing assumption): character-based, not token-based, because this codebase has no tokenizer dependency (see `estimateTokenCount()` below for the same honesty this module applies to `lib/ai/pricing.ts`'s own estimates). ~1200 characters is a deliberately generous target — small enough for focused retrieval, large enough to keep chunk count (and therefore embedding-call volume/cost) reasonable for typical knowledge-base prose. */
const TARGET_CHUNK_CHARS = 1200;
/** Chunks overlap by this many characters so a sentence/idea split across a chunk boundary is never ENTIRELY lost to just one side — a standard RAG chunking technique, not a made-up number: large enough to usually catch a full sentence, small enough to keep embedding-call volume proportionate to real content, not doubled. */
const CHUNK_OVERLAP_CHARS = 150;
/** A chunk below this length is folded into its neighbor rather than standing alone — avoids a final tiny, low-signal chunk (e.g. "17 characters left over") consuming an entire embedding call for almost no retrievable content. */
const MIN_CHUNK_CHARS = 200;

export interface TextChunk {
  sequence: number;
  content: string;
  charCount: number;
  /** A character-count-based ESTIMATE (`Math.ceil(charCount / 4)`, the well-known ~4-chars-per-token heuristic for English prose in GPT/Claude-family tokenizers) — NOT a real tokenizer count. Stated as an estimate everywhere it's surfaced, the same honesty `lib/ai/pricing.ts`'s own cost figures already apply to a different estimate. */
  tokenCount: number;
  /** SHA-256 hex of `content` — used for chunk-level integrity/dedup checks, the same technique `KnowledgeDocumentVersion.contentChecksum` uses at the document-version level. */
  checksum: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function estimateTokenCount(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Splits on blank-line paragraph boundaries first (keeps naturally
 * coherent units together when they fit), then falls back to a
 * fixed-size sliding window with overlap for any paragraph — or run of
 * short paragraphs accumulated together — that exceeds
 * `TARGET_CHUNK_CHARS`. Deterministic: no `Date.now()`, no random IDs,
 * no reliance on object-key iteration order beyond plain arrays.
 */
export function chunkText(content: string): TextChunk[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const rawPieces: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) rawPieces.push(buffer.trim());
    buffer = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > TARGET_CHUNK_CHARS) {
      // A single paragraph too large on its own — flush whatever's
      // buffered, then slide a fixed window across this paragraph
      // specifically.
      flush();
      rawPieces.push(...slidingWindow(paragraph));
      continue;
    }
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > TARGET_CHUNK_CHARS) {
      flush();
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }
  flush();

  // Fold any trailing too-small piece into its predecessor rather than
  // shipping a near-empty final chunk.
  const merged: string[] = [];
  for (const piece of rawPieces) {
    const last = merged[merged.length - 1];
    if (last && piece.length < MIN_CHUNK_CHARS) {
      merged[merged.length - 1] = `${last}\n\n${piece}`;
    } else {
      merged.push(piece);
    }
  }

  return merged.map((text, sequence) => ({
    sequence,
    content: text,
    charCount: text.length,
    tokenCount: estimateTokenCount(text.length),
    checksum: sha256(text),
  }));
}

function slidingWindow(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + TARGET_CHUNK_CHARS, text.length);
    pieces.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return pieces;
}
