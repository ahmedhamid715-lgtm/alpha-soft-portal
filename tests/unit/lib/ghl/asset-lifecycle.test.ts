import { describe, expect, it } from "vitest";
import { canTransitionGhlAsset, GHL_ASSET_READY_STATUSES, type GhlAssetImplementationStatus } from "@/lib/ghl/asset-lifecycle";

describe("canTransitionGhlAsset", () => {
  it("allows the real forward path", () => {
    expect(canTransitionGhlAsset("PLANNED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionGhlAsset("IN_PROGRESS", "READY_FOR_QA")).toBe(true);
    expect(canTransitionGhlAsset("READY_FOR_QA", "READY")).toBe(true);
    expect(canTransitionGhlAsset("READY", "LIVE")).toBe(true);
  });

  it("allows the QA_FAILED rework loop", () => {
    expect(canTransitionGhlAsset("READY_FOR_QA", "QA_FAILED")).toBe(true);
    expect(canTransitionGhlAsset("QA_FAILED", "IN_PROGRESS")).toBe(true);
  });

  it("rejects skipping straight to READY/LIVE from PLANNED", () => {
    expect(canTransitionGhlAsset("PLANNED", "READY")).toBe(false);
    expect(canTransitionGhlAsset("PLANNED", "LIVE")).toBe(false);
  });

  it("rejects a QA_FAILED asset moving directly to READY without rework", () => {
    expect(canTransitionGhlAsset("QA_FAILED", "READY")).toBe(false);
  });

  it("allows ARCHIVED from every non-terminal state", () => {
    const nonTerminal: GhlAssetImplementationStatus[] = ["PLANNED", "IN_PROGRESS", "READY_FOR_QA", "QA_FAILED", "READY", "LIVE"];
    for (const status of nonTerminal) expect(canTransitionGhlAsset(status, "ARCHIVED")).toBe(true);
  });

  it("allows reactivation from ARCHIVED only back to IN_PROGRESS, never straight to READY/LIVE", () => {
    expect(canTransitionGhlAsset("ARCHIVED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionGhlAsset("ARCHIVED", "READY")).toBe(false);
    expect(canTransitionGhlAsset("ARCHIVED", "LIVE")).toBe(false);
  });

  it("rejects a self-transition", () => {
    expect(canTransitionGhlAsset("IN_PROGRESS", "IN_PROGRESS")).toBe(false);
  });
});

describe("GHL_ASSET_READY_STATUSES", () => {
  it("counts READY and LIVE as complete for the readiness formula, nothing else", () => {
    expect(GHL_ASSET_READY_STATUSES).toEqual(["READY", "LIVE"]);
  });
});
