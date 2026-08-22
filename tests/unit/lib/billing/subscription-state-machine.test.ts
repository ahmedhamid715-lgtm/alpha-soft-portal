import { describe, expect, it } from "vitest";
import { validateSubscriptionTransition, canPerformAction, describeLifecycleState } from "@/lib/billing/subscription-state-machine";
import { SubscriptionChangeRejectedError } from "@/lib/billing/errors";
import type { SubscriptionStatus } from "@/generated/prisma/client";

/**
 * Module 14 spec §40 — explicit tests for every valid AND invalid
 * subscription transition, not merely the happy path.
 */

describe("validateSubscriptionTransition — valid transitions", () => {
  it("ACTIVE → SCHEDULE_CANCELLATION", () => {
    expect(() => validateSubscriptionTransition("ACTIVE", false, "SCHEDULE_CANCELLATION")).not.toThrow();
  });

  it("ACTIVE (cancel scheduled) → UNDO_SCHEDULED_CANCELLATION", () => {
    expect(() => validateSubscriptionTransition("ACTIVE", true, "UNDO_SCHEDULED_CANCELLATION")).not.toThrow();
  });

  it("ACTIVE → CHANGE_PLAN (upgrade/downgrade)", () => {
    expect(() => validateSubscriptionTransition("ACTIVE", false, "CHANGE_PLAN")).not.toThrow();
  });

  it("ACTIVE → CANCEL_IMMEDIATELY", () => {
    expect(() => validateSubscriptionTransition("ACTIVE", false, "CANCEL_IMMEDIATELY")).not.toThrow();
  });

  it("TRIALING → CHANGE_PLAN", () => {
    expect(() => validateSubscriptionTransition("TRIALING", false, "CHANGE_PLAN")).not.toThrow();
  });

  it("TRIALING → SCHEDULE_CANCELLATION", () => {
    expect(() => validateSubscriptionTransition("TRIALING", false, "SCHEDULE_CANCELLATION")).not.toThrow();
  });

  it("PAST_DUE → ACTIVATE (payment recovered)", () => {
    expect(() => validateSubscriptionTransition("PAST_DUE", false, "ACTIVATE")).not.toThrow();
  });

  it("PAST_DUE → CANCEL_IMMEDIATELY", () => {
    expect(() => validateSubscriptionTransition("PAST_DUE", false, "CANCEL_IMMEDIATELY")).not.toThrow();
  });

  it("UNPAID → ACTIVATE (payment recovered)", () => {
    expect(() => validateSubscriptionTransition("UNPAID", false, "ACTIVATE")).not.toThrow();
  });

  it("INCOMPLETE → ACTIVATE (first payment succeeded)", () => {
    expect(() => validateSubscriptionTransition("INCOMPLETE", false, "ACTIVATE")).not.toThrow();
  });
});

describe("validateSubscriptionTransition — invalid transitions (spec §40's own explicit matrix)", () => {
  it("CANCELED → ACTIVE-equivalent (ACTIVATE) is rejected — terminal, spec's own explicit prohibition", () => {
    expect(() => validateSubscriptionTransition("CANCELED", false, "ACTIVATE")).toThrow(SubscriptionChangeRejectedError);
  });

  it("CANCELED → CHANGE_PLAN is rejected", () => {
    expect(() => validateSubscriptionTransition("CANCELED", false, "CHANGE_PLAN")).toThrow(SubscriptionChangeRejectedError);
  });

  it("CANCELED → SCHEDULE_CANCELLATION is rejected (already terminal)", () => {
    expect(() => validateSubscriptionTransition("CANCELED", false, "SCHEDULE_CANCELLATION")).toThrow(SubscriptionChangeRejectedError);
  });

  it("INCOMPLETE_EXPIRED → anything is rejected — terminal", () => {
    expect(() => validateSubscriptionTransition("INCOMPLETE_EXPIRED", false, "ACTIVATE")).toThrow(SubscriptionChangeRejectedError);
    expect(() => validateSubscriptionTransition("INCOMPLETE_EXPIRED", false, "CHANGE_PLAN")).toThrow(SubscriptionChangeRejectedError);
  });

  it("ACTIVE → SCHEDULE_CANCELLATION when already scheduled is rejected (double-cancel guard)", () => {
    expect(() => validateSubscriptionTransition("ACTIVE", true, "SCHEDULE_CANCELLATION")).toThrow(SubscriptionChangeRejectedError);
  });

  it("ACTIVE → UNDO_SCHEDULED_CANCELLATION when nothing is scheduled is rejected", () => {
    expect(() => validateSubscriptionTransition("ACTIVE", false, "UNDO_SCHEDULED_CANCELLATION")).toThrow(SubscriptionChangeRejectedError);
  });

  it("PAUSED → CHANGE_PLAN is rejected — a paused subscription cannot be upgraded/downgraded", () => {
    expect(() => validateSubscriptionTransition("PAUSED", false, "CHANGE_PLAN")).toThrow(SubscriptionChangeRejectedError);
  });

  it("UNPAID → SCHEDULE_CANCELLATION is rejected — not a valid action from UNPAID", () => {
    expect(() => validateSubscriptionTransition("UNPAID", false, "SCHEDULE_CANCELLATION")).toThrow(SubscriptionChangeRejectedError);
  });
});

describe("canPerformAction — the UI-facing, non-throwing check", () => {
  it("returns true for a valid transition", () => {
    expect(canPerformAction("ACTIVE", false, "SCHEDULE_CANCELLATION")).toBe(true);
  });

  it("returns false for an invalid transition, never throws", () => {
    expect(canPerformAction("CANCELED", false, "ACTIVATE")).toBe(false);
  });
});

describe("describeLifecycleState", () => {
  it("folds ACTIVE + cancelAtPeriodEnd into ACTIVE_CANCEL_AT_PERIOD_END", () => {
    expect(describeLifecycleState("ACTIVE", true)).toBe("ACTIVE_CANCEL_AT_PERIOD_END");
  });

  it("leaves plain ACTIVE alone when nothing is scheduled", () => {
    expect(describeLifecycleState("ACTIVE", false)).toBe("ACTIVE");
  });

  it("ignores cancelAtPeriodEnd for every other status (it's only meaningful on ACTIVE)", () => {
    const statuses: SubscriptionStatus[] = ["TRIALING", "PAST_DUE", "PAUSED", "CANCELED", "INCOMPLETE", "INCOMPLETE_EXPIRED", "UNPAID"];
    for (const status of statuses) {
      expect(describeLifecycleState(status, true)).toBe(status);
    }
  });
});
