import { describe, it, expect } from "vitest";
import { classifyFreshness } from "@/lib/seo/freshness";

const NOW = new Date("2026-09-15T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("classifyFreshness", () => {
  it("returns NEVER_COLLECTED for null", () => {
    expect(classifyFreshness(null, NOW)).toBe("NEVER_COLLECTED");
  });

  it("returns FRESH within 7 days", () => {
    expect(classifyFreshness(daysAgo(0), NOW)).toBe("FRESH");
    expect(classifyFreshness(daysAgo(7), NOW)).toBe("FRESH");
  });

  it("returns AGING between 8 and 30 days", () => {
    expect(classifyFreshness(daysAgo(8), NOW)).toBe("AGING");
    expect(classifyFreshness(daysAgo(30), NOW)).toBe("AGING");
  });

  it("returns STALE beyond 30 days", () => {
    expect(classifyFreshness(daysAgo(31), NOW)).toBe("STALE");
    expect(classifyFreshness(daysAgo(365), NOW)).toBe("STALE");
  });
});
