import { describe, it, expect } from "vitest";
import { normalizeEcommerceHandle, InvalidEcommerceHandleError } from "@/lib/ecommerce/handle";

describe("normalizeEcommerceHandle", () => {
  it("accepts a simple lowercase handle unchanged", () => {
    expect(normalizeEcommerceHandle("blue-t-shirt")).toBe("blue-t-shirt");
  });

  it("lowercases and trims", () => {
    expect(normalizeEcommerceHandle("  Blue-T-Shirt  ")).toBe("blue-t-shirt");
  });

  it("accepts digits", () => {
    expect(normalizeEcommerceHandle("product-2024")).toBe("product-2024");
  });

  it("rejects an empty value", () => {
    expect(() => normalizeEcommerceHandle("   ")).toThrow(InvalidEcommerceHandleError);
  });

  it("rejects a leading or trailing hyphen", () => {
    expect(() => normalizeEcommerceHandle("-blue-shirt")).toThrow(InvalidEcommerceHandleError);
    expect(() => normalizeEcommerceHandle("blue-shirt-")).toThrow(InvalidEcommerceHandleError);
  });

  it("rejects consecutive hyphens", () => {
    expect(() => normalizeEcommerceHandle("blue--shirt")).toThrow(InvalidEcommerceHandleError);
  });

  it("rejects a leading slash or nested path segments — a handle is one segment, not a path", () => {
    expect(() => normalizeEcommerceHandle("/blue-shirt")).toThrow(InvalidEcommerceHandleError);
    expect(() => normalizeEcommerceHandle("category/blue-shirt")).toThrow(InvalidEcommerceHandleError);
  });

  it("rejects spaces and disallowed characters", () => {
    expect(() => normalizeEcommerceHandle("blue shirt")).toThrow(InvalidEcommerceHandleError);
    expect(() => normalizeEcommerceHandle("blue_shirt")).toThrow(InvalidEcommerceHandleError);
    expect(() => normalizeEcommerceHandle("blue<script>")).toThrow(InvalidEcommerceHandleError);
  });

  it("rejects a value over 200 characters", () => {
    expect(() => normalizeEcommerceHandle("a".repeat(201))).toThrow(InvalidEcommerceHandleError);
  });
});
