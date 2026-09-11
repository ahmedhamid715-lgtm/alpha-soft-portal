/**
 * `CustomerService` lifecycle state machine (Build 29 — Roadmap Module
 * 23) — pure, isomorphic, server-authoritative. Mirrors
 * `src/lib/projects/lifecycle.ts`'s own exact shape and reasoning. The
 * UI is never lifecycle authority; every transition request is
 * validated against this table before any write happens, and every
 * transition is additionally CAS-guarded at the repository layer (see
 * `customer-service-service.ts`).
 *
 * `ServiceDefinition` has its own, much simpler two-state lifecycle
 * (ACTIVE/ARCHIVED, handled directly in the service layer — a table
 * for two states with one edge each way would be pure ceremony).
 */
export type CustomerServiceStatus = "PENDING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

/**
 * COMPLETED → ACTIVE (reopening) is intentionally allowed — a client
 * requesting more work on a "finished" service is a real, common
 * scenario, same reasoning `ProjectStatus`'s own COMPLETED → ACTIVE
 * edge documents. CANCELLED has NO outgoing transitions — cancellation
 * is a harder, final stop than completion (there is no "un-cancel";
 * provision a fresh `CustomerService` instead, which is exactly what
 * the DB-level idempotency partial unique index is designed to allow
 * once the cancelled row no longer blocks a new attempt).
 */
const CUSTOMER_SERVICE_TRANSITIONS: Record<CustomerServiceStatus, CustomerServiceStatus[]> = {
  PENDING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: [],
};

/** "No further routine progression without an explicit reopen action" — COMPLETED is listed here even though it has one outgoing edge (reopen), same convention `PROJECT_TERMINAL_STATUSES` already establishes for `ProjectStatus.COMPLETED`. */
export const CUSTOMER_SERVICE_TERMINAL_STATUSES: CustomerServiceStatus[] = ["COMPLETED", "CANCELLED"];

export function canTransitionCustomerService(from: CustomerServiceStatus, to: CustomerServiceStatus): boolean {
  return CUSTOMER_SERVICE_TRANSITIONS[from].includes(to);
}
