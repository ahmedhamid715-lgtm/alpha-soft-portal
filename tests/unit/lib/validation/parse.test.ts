import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseOrThrow, safeParseResult, optionalFromQueryParam } from "@/lib/validation/parse";
import { ValidationError } from "@/lib/errors/app-error";

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0),
});

describe("parseOrThrow", () => {
  it("returns typed data for valid input", () => {
    const result = parseOrThrow(schema, { email: "a@example.com", age: 30 });
    expect(result).toEqual({ email: "a@example.com", age: 30 });
  });

  it("throws a ValidationError for invalid input", () => {
    expect(() => parseOrThrow(schema, { email: "not-an-email", age: -1 })).toThrow(ValidationError);
  });

  it("includes a field-level breakdown in the thrown error's details", () => {
    try {
      parseOrThrow(schema, { email: "not-an-email", age: -1 });
      expect.unreachable("parseOrThrow should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.statusCode).toBe(400);
      expect(validationError.details?.fieldErrors).toHaveProperty("email");
      expect(validationError.details?.fieldErrors).toHaveProperty("age");
    }
  });

  it("rejects malicious/unexpected shapes (extra fields don't smuggle through as valid)", () => {
    expect(() => parseOrThrow(schema, { email: "a@example.com" /* missing age */ })).toThrow(ValidationError);
  });
});

describe("optionalFromQueryParam", () => {
  // Regression coverage for a real bug (Module 10's own Playwright
  // testing of `/admin/users`' filter form against a production build):
  // a `<select>`'s unselected "Any status" option submits `status=`
  // (empty string), not an absent key — a bare `z.enum([...]).optional()`
  // schema rejects that as invalid instead of treating it as "no
  // filter," crashing the whole page. `audit/query.ts` had already
  // solved this once for date/string filters before this helper was
  // promoted to be shared; this suite is what proves it generalizes to
  // enums too, which is exactly the case that crashed.
  const filterSchema = z.object({
    status: optionalFromQueryParam(z.enum(["ACTIVE", "SUSPENDED"])),
  });

  it("treats an empty string the same as an absent key — never a validation error", () => {
    expect(parseOrThrow(filterSchema, { status: "" })).toEqual({ status: undefined });
    expect(parseOrThrow(filterSchema, {})).toEqual({ status: undefined });
  });

  it("still validates a real, non-empty value against the inner schema", () => {
    expect(parseOrThrow(filterSchema, { status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(() => parseOrThrow(filterSchema, { status: "NOT_A_REAL_STATUS" })).toThrow(ValidationError);
  });
});

describe("safeParseResult", () => {
  it("returns a success result without throwing", () => {
    const result = safeParseResult(schema, { email: "a@example.com", age: 30 });
    expect(result.success).toBe(true);
  });

  it("returns field errors without throwing", () => {
    const result = safeParseResult(schema, { email: "bad", age: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toHaveProperty("email");
    }
  });
});
