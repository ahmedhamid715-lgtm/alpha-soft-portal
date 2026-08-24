import { describe, expect, it } from "vitest";
import { requiresElevatedAccess } from "@/lib/knowledge/classification";

describe("requiresElevatedAccess", () => {
  it("does not require elevated access for PUBLIC or INTERNAL", () => {
    expect(requiresElevatedAccess("PUBLIC")).toBe(false);
    expect(requiresElevatedAccess("INTERNAL")).toBe(false);
  });

  it("requires elevated access for CONFIDENTIAL and RESTRICTED", () => {
    expect(requiresElevatedAccess("CONFIDENTIAL")).toBe(true);
    expect(requiresElevatedAccess("RESTRICTED")).toBe(true);
  });
});
