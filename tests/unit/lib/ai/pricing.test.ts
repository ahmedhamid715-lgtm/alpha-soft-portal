import { describe, expect, it } from "vitest";
import { computeCost } from "@/lib/ai/pricing";

describe("computeCost", () => {
  it("computes input + output cost separately, in minor USD units", () => {
    // claude-opus-5: 1,500,00 cents/million input, 7,500,00 cents/million output
    const cost = computeCost("claude-opus-5", 1_000_000, 1_000_000);
    expect(cost).toBe(1_500_00 + 7_500_00);
  });

  it("is exactly 0 for a model call with 0 tokens either way", () => {
    expect(computeCost("claude-opus-5", 0, 0)).toBe(0);
  });

  it("resolves a dated model snapshot id (a real prefix, not an exact catalog key) to its family's rate", () => {
    const dated = computeCost("claude-sonnet-5-20260115", 1_000_000, 0);
    const exact = computeCost("claude-sonnet-5", 1_000_000, 0);
    expect(dated).toBe(exact);
  });

  it("different model families produce different costs for the identical token counts", () => {
    const opus = computeCost("claude-opus-5", 100_000, 100_000);
    const haiku = computeCost("claude-haiku-4-5", 100_000, 100_000);
    expect(opus).toBeGreaterThan(haiku);
  });

  it("an entirely unrecognized model id falls back to the conservative (Opus-tier) default rather than under-reporting cost", () => {
    const unknown = computeCost("some-future-model-nobody-has-heard-of", 1_000_000, 0);
    const opus = computeCost("claude-opus-5", 1_000_000, 0);
    expect(unknown).toBe(opus);
  });

  it("is a real integer, never a float artifact, for a token count that does not divide evenly", () => {
    const cost = computeCost("claude-opus-5", 333, 777);
    expect(Number.isInteger(cost)).toBe(true);
  });

  it("scales linearly with token count for a fixed model", () => {
    const small = computeCost("claude-sonnet-5", 1000, 500);
    const large = computeCost("claude-sonnet-5", 10_000, 5000);
    expect(large).toBe(small * 10);
  });
});
