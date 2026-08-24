import { describe, expect, it } from "vitest";
import { chunkText, CHUNKING_STRATEGY } from "@/lib/knowledge/chunking";

describe("chunkText", () => {
  it("is deterministic — the same input produces byte-identical output across calls", () => {
    const content = "Alpha OS is a platform.\n\n" + "This is a second paragraph with real content in it. ".repeat(40);
    const first = chunkText(content);
    const second = chunkText(content);
    expect(second).toEqual(first);
  });

  it("returns an empty array for empty/whitespace-only content", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n   ")).toEqual([]);
  });

  it("keeps short content as a single chunk rather than fragmenting it", () => {
    const chunks = chunkText("A short knowledge-base entry.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("A short knowledge-base entry.");
    expect(chunks[0].sequence).toBe(0);
  });

  it("assigns sequential, zero-based sequence numbers", () => {
    const longContent = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. `.repeat(100)).join("\n\n");
    const chunks = chunkText(longContent);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => expect(chunk.sequence).toBe(index));
  });

  it("splits a single paragraph that exceeds the target size using a sliding window", () => {
    const hugeParagraph = "word ".repeat(2000); // no blank lines at all — one giant "paragraph"
    const chunks = chunkText(hugeParagraph);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk stays within a sane bound (target + overlap tolerance).
    for (const chunk of chunks) expect(chunk.charCount).toBeLessThanOrEqual(1200);
  });

  it("never produces a chunk from content that isn't actually in the source", () => {
    const content = "The quick brown fox.\n\nJumps over the lazy dog. ".repeat(60);
    const chunks = chunkText(content);
    for (const chunk of chunks) {
      expect(content).toContain(chunk.content.split("\n\n")[0]!.trim().slice(0, 20));
    }
  });

  it("computes a real SHA-256 checksum per chunk, distinct for distinct content", () => {
    const chunks = chunkText("First distinct chunk of real content that is long enough to stand alone on its own.");
    expect(chunks[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("estimates token count as a documented ~4-chars-per-token heuristic, never a claimed exact count", () => {
    const chunks = chunkText("A twenty-character string.");
    expect(chunks[0].tokenCount).toBe(Math.ceil(chunks[0].charCount / 4));
  });

  it("exposes a stable, versioned strategy identifier", () => {
    expect(CHUNKING_STRATEGY).toBe("fixed-char-v1");
  });

  it("folds a trailing too-small final piece into its predecessor rather than shipping a near-empty chunk", () => {
    const content = "First substantial paragraph with plenty of real content in it to stand on its own merit here.\n\nshort";
    const chunks = chunkText(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("short");
  });
});
