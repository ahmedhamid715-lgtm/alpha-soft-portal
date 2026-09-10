import { describe, expect, it } from "vitest";
import { wouldCreateCycle, type DependencyEdge } from "@/lib/projects/dependency-graph";

describe("wouldCreateCycle", () => {
  it("allows a fresh edge with no existing dependencies", () => {
    expect(wouldCreateCycle([], { taskId: "B", dependsOnTaskId: "A" })).toBe(false);
  });

  it("allows a chain A <- B <- C (C depends on B, B depends on A) — no cycle", () => {
    const existing: DependencyEdge[] = [{ taskId: "B", dependsOnTaskId: "A" }];
    expect(wouldCreateCycle(existing, { taskId: "C", dependsOnTaskId: "B" })).toBe(false);
  });

  it("REQUIRED CASE: A -> B -> C, then C -> A is rejected as a cycle", () => {
    // "B depends on A" and "C depends on B" already exist.
    const existing: DependencyEdge[] = [
      { taskId: "B", dependsOnTaskId: "A" },
      { taskId: "C", dependsOnTaskId: "B" },
    ];
    // Adding "A depends on C" would close the loop A -> B -> C -> A.
    expect(wouldCreateCycle(existing, { taskId: "A", dependsOnTaskId: "C" })).toBe(true);
  });

  it("rejects a direct two-node cycle (A depends on B, then B depends on A)", () => {
    const existing: DependencyEdge[] = [{ taskId: "A", dependsOnTaskId: "B" }];
    expect(wouldCreateCycle(existing, { taskId: "B", dependsOnTaskId: "A" })).toBe(true);
  });

  it("allows a diamond dependency shape (no cycle): D depends on B and C, both of which depend on A", () => {
    const existing: DependencyEdge[] = [
      { taskId: "B", dependsOnTaskId: "A" },
      { taskId: "C", dependsOnTaskId: "A" },
      { taskId: "D", dependsOnTaskId: "B" },
    ];
    expect(wouldCreateCycle(existing, { taskId: "D", dependsOnTaskId: "C" })).toBe(false);
  });

  it("does not report an exact duplicate edge as a cycle (the unique index/caller handles that case with a clearer error)", () => {
    const existing: DependencyEdge[] = [{ taskId: "B", dependsOnTaskId: "A" }];
    expect(wouldCreateCycle(existing, { taskId: "B", dependsOnTaskId: "A" })).toBe(false);
  });

  it("is unaffected by edges in a completely disconnected part of the graph", () => {
    const existing: DependencyEdge[] = [{ taskId: "X", dependsOnTaskId: "Y" }];
    expect(wouldCreateCycle(existing, { taskId: "B", dependsOnTaskId: "A" })).toBe(false);
  });
});
