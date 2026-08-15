import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  isAppError,
  toAppError,
} from "@/lib/errors/app-error";

describe("AppError subclasses", () => {
  it("assigns the correct code and status per subclass", () => {
    expect(new ValidationError("bad input")).toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    expect(new NotFoundError("Ticket")).toMatchObject({ code: "NOT_FOUND", statusCode: 404, message: "Ticket was not found." });
    expect(new ConflictError("duplicate")).toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("marks known error types as operational, InternalServerError as not", () => {
    expect(new ValidationError("x").isOperational).toBe(true);
    expect(new InternalServerError().isOperational).toBe(false);
  });

  it("toSafeJSON never includes a stack trace", () => {
    const error = new ValidationError("bad input", { details: { field: "email" } });
    const safe = error.toSafeJSON();
    expect(safe).toEqual({ code: "VALIDATION_ERROR", message: "bad input", details: { field: "email" } });
    expect(Object.keys(safe)).not.toContain("stack");
  });

  it("toSafeJSON omits details when none were provided", () => {
    const safe = new NotFoundError("Ticket").toSafeJSON();
    expect(safe).toEqual({ code: "NOT_FOUND", message: "Ticket was not found." });
  });
});

describe("isAppError / toAppError", () => {
  it("recognizes AppError instances", () => {
    expect(isAppError(new ValidationError("x"))).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(isAppError("not an error")).toBe(false);
  });

  it("passes an existing AppError through unchanged", () => {
    const original = new ConflictError("dup");
    expect(toAppError(original)).toBe(original);
  });

  it("normalizes an unknown thrown value to a non-operational InternalServerError", () => {
    const normalized = toAppError(new Error("raw driver failure"));
    expect(normalized).toBeInstanceOf(InternalServerError);
    expect(normalized.isOperational).toBe(false);
    // The safe message must NOT leak the original error text.
    expect(normalized.message).toBe("An unexpected error occurred.");
    expect(normalized.message).not.toContain("raw driver failure");
  });

  it("normalizes non-Error thrown values (e.g. a thrown string) the same way", () => {
    const normalized = toAppError("something went wrong");
    expect(normalized).toBeInstanceOf(InternalServerError);
  });

  it("every AppError subclass is an instance of AppError", () => {
    expect(new ValidationError("x")).toBeInstanceOf(AppError);
  });
});
