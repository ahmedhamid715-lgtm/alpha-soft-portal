import { describe, expect, it } from "vitest";
import { generateId, isValidId } from "@/lib/utils/id";

describe("id strategy", () => {
  it("generates a valid UUID", () => {
    expect(isValidId(generateId())).toBe(true);
  });

  it("generates version-7 UUIDs specifically", () => {
    const id = generateId();
    // Version nibble is the first character of the third group.
    const versionChar = id.split("-")[2]?.[0];
    expect(versionChar).toBe("7");
  });

  it("generates unique IDs across calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it("is time-ordered — later calls sort after earlier ones", () => {
    const first = generateId();
    const second = generateId();
    expect(first < second).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
  });
});
