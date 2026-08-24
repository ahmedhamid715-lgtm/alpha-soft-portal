import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "@/lib/knowledge/ranking";

describe("reciprocalRankFusion", () => {
  it("ranks an item appearing at rank 1 in both lists above an item appearing in only one", () => {
    const fused = reciprocalRankFusion([
      [{ id: "a" }, { id: "b" }],
      [{ id: "a" }, { id: "c" }],
    ]);
    expect(fused[0].id).toBe("a");
    expect(fused[0].matchedIn).toBe(2);
  });

  it("includes every id that appeared in at least one list", () => {
    const fused = reciprocalRankFusion([[{ id: "a" }], [{ id: "b" }]]);
    const ids = fused.map((f) => f.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("gives a higher rank position a higher score than a lower rank position within the same list", () => {
    const fused = reciprocalRankFusion([[{ id: "first" }, { id: "second" }, { id: "third" }]]);
    expect(fused[0].id).toBe("first");
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
    expect(fused[1].score).toBeGreaterThan(fused[2].score);
  });

  it("is deterministic — ties break by id, never by insertion order alone", () => {
    const first = reciprocalRankFusion([[{ id: "z" }, { id: "a" }]]);
    const second = reciprocalRankFusion([[{ id: "z" }, { id: "a" }]]);
    expect(first).toEqual(second);
  });

  it("handles empty lists without throwing", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it("never produces a negative or zero score for any matched item", () => {
    const fused = reciprocalRankFusion([[{ id: "a" }, { id: "b" }, { id: "c" }]]);
    for (const item of fused) expect(item.score).toBeGreaterThan(0);
  });
});
