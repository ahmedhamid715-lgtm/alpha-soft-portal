import { describe, expect, it } from "vitest";
import { canTransitionCustomerService, CUSTOMER_SERVICE_TERMINAL_STATUSES, type CustomerServiceStatus } from "@/lib/services/lifecycle";

const ALL_STATUSES: CustomerServiceStatus[] = ["PENDING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

describe("canTransitionCustomerService", () => {
  it("allows the documented forward path: PENDING -> ACTIVE -> PAUSED -> ACTIVE -> COMPLETED", () => {
    expect(canTransitionCustomerService("PENDING", "ACTIVE")).toBe(true);
    expect(canTransitionCustomerService("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionCustomerService("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransitionCustomerService("ACTIVE", "COMPLETED")).toBe(true);
  });

  it("allows cancellation from PENDING, ACTIVE, and PAUSED", () => {
    expect(canTransitionCustomerService("PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionCustomerService("ACTIVE", "CANCELLED")).toBe(true);
    expect(canTransitionCustomerService("PAUSED", "CANCELLED")).toBe(true);
  });

  it("allows reopening a COMPLETED service back to ACTIVE", () => {
    expect(canTransitionCustomerService("COMPLETED", "ACTIVE")).toBe(true);
  });

  it("CANCELLED has zero outgoing transitions — a harder stop than COMPLETED, no un-cancel", () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionCustomerService("CANCELLED", to)).toBe(false);
    }
  });

  it("COMPLETED only reopens to ACTIVE, never directly to PENDING/PAUSED/CANCELLED", () => {
    expect(canTransitionCustomerService("COMPLETED", "PENDING")).toBe(false);
    expect(canTransitionCustomerService("COMPLETED", "PAUSED")).toBe(false);
    expect(canTransitionCustomerService("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("PENDING cannot jump directly to PAUSED or COMPLETED", () => {
    expect(canTransitionCustomerService("PENDING", "PAUSED")).toBe(false);
    expect(canTransitionCustomerService("PENDING", "COMPLETED")).toBe(false);
  });

  it("no status transitions to itself", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionCustomerService(status, status)).toBe(false);
    }
  });

  it("terminal statuses are exactly COMPLETED and CANCELLED", () => {
    expect([...CUSTOMER_SERVICE_TERMINAL_STATUSES].sort()).toEqual(["CANCELLED", "COMPLETED"]);
  });
});
