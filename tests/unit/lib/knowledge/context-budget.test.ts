import { describe, expect, it } from "vitest";
import { selectWithinBudget, DEFAULT_CONTEXT_CHAR_BUDGET } from "@/lib/knowledge/context-budget";

describe("selectWithinBudget", () => {
  it("selects every item when the total fits comfortably within budget", () => {
    const items = [{ id: "1", content: "a".repeat(100) }, { id: "2", content: "b".repeat(100) }];
    const result = selectWithinBudget(items, 1000);
    expect(result.selected).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.usedChars).toBe(200);
  });

  it("NEVER exceeds the budget — the core hard-limit guarantee (spec §13)", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, content: "x".repeat(500) }));
    const result = selectWithinBudget(items, 1000);
    expect(result.usedChars).toBeLessThanOrEqual(1000);
  });

  it("flags truncated: true when at least one candidate was excluded for exceeding the budget", () => {
    const items = [{ id: "1", content: "a".repeat(600) }, { id: "2", content: "b".repeat(600) }];
    const result = selectWithinBudget(items, 1000);
    expect(result.selected).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("preserves the caller's own ranking order — never reorders to pack more items in", () => {
    const items = [{ id: "big", content: "a".repeat(900) }, { id: "small", content: "b".repeat(50) }];
    // "small" would fit if reordered first, but the function must not do that.
    const result = selectWithinBudget(items, 950);
    expect(result.selected.map((s) => s.id)).toEqual(["big", "small"]);
  });

  it("stops at the first item that would exceed the budget rather than skipping it for a later smaller one", () => {
    const items = [{ id: "too-big", content: "a".repeat(2000) }, { id: "would-fit", content: "b".repeat(10) }];
    const result = selectWithinBudget(items, 1000);
    expect(result.selected).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  it("defaults to DEFAULT_CONTEXT_CHAR_BUDGET when no budget is passed", () => {
    const items = [{ id: "1", content: "a".repeat(DEFAULT_CONTEXT_CHAR_BUDGET + 1) }];
    const result = selectWithinBudget(items);
    expect(result.budgetChars).toBe(DEFAULT_CONTEXT_CHAR_BUDGET);
    expect(result.truncated).toBe(true);
  });

  it("handles an empty item list", () => {
    const result = selectWithinBudget([], 1000);
    expect(result.selected).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.usedChars).toBe(0);
  });
});
