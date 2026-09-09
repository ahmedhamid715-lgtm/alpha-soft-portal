import { describe, expect, it } from "vitest";
import {
  computeCustomerHealth,
  evaluateEngagement,
  evaluateOnboardingHealth,
  evaluateProjectHealth,
  evaluateSupportHealth,
  evaluateServicePerformance,
  toPaymentHealthComponent,
  evaluateChurnRisk,
  HEALTH_STATUS_SCORE,
  type HealthComponent,
} from "@/lib/crm/client-success";

const NOW = new Date("2026-06-15T12:00:00Z");

function component(overrides: Partial<HealthComponent>): HealthComponent {
  return { key: "payment", label: "Payment", status: "HEALTHY", score: 100, measurable: true, reason: "test", source: "test", lastEvaluatedAt: NOW, ...overrides };
}

describe("client-success", () => {
  describe("computeCustomerHealth", () => {
    it("returns NOT_MEASURABLE / null score when zero components are measurable — never a fabricated number", () => {
      const result = computeCustomerHealth([
        component({ key: "payment", measurable: false, score: null, status: "NOT_MEASURABLE" }),
        component({ key: "engagement", measurable: false, score: null, status: "NOT_MEASURABLE" }),
      ]);
      expect(result.overallScore).toBeNull();
      expect(result.overallStatus).toBe("NOT_MEASURABLE");
      expect(result.coverage).toEqual({ measurable: 0, total: 2 });
    });

    it("never treats a missing component as 0 — a NOT_MEASURABLE project component does not drag down an otherwise-healthy score", () => {
      const allHealthy = computeCustomerHealth([component({ key: "payment", status: "HEALTHY", score: 100 }), component({ key: "onboarding", status: "HEALTHY", score: 100 })]);
      const withUnmeasurableProject = computeCustomerHealth([
        component({ key: "payment", status: "HEALTHY", score: 100 }),
        component({ key: "onboarding", status: "HEALTHY", score: 100 }),
        component({ key: "project", status: "NOT_MEASURABLE", score: null, measurable: false }),
      ]);
      expect(withUnmeasurableProject.overallScore).toBe(allHealthy.overallScore);
      expect(withUnmeasurableProject.overallScore).toBe(100);
    });

    it("renormalizes the weighted average against only the measurable weights, not the fixed 100-point total", () => {
      // payment (weight 30, score 100) + onboarding (weight 25, score 10 -> CRITICAL)
      const result = computeCustomerHealth([component({ key: "payment", status: "HEALTHY", score: 100 }), component({ key: "onboarding", status: "CRITICAL", score: 10 })]);
      // (30*100 + 25*10) / (30+25) = (3000+250)/55 = 59.09 -> 59
      expect(result.overallScore).toBe(59);
      expect(result.coverage).toEqual({ measurable: 2, total: 2 });
    });

    it("buckets the overall score back into a status using the documented fixed cutoffs", () => {
      expect(computeCustomerHealth([component({ score: 85 })]).overallStatus).toBe("HEALTHY");
      expect(computeCustomerHealth([component({ score: 60 })]).overallStatus).toBe("WATCH");
      expect(computeCustomerHealth([component({ score: 35 })]).overallStatus).toBe("AT_RISK");
      expect(computeCustomerHealth([component({ score: 15 })]).overallStatus).toBe("CRITICAL");
    });
  });

  describe("evaluateEngagement", () => {
    it("is NOT_MEASURABLE when there is no activity at all — never fabricated inactivity", () => {
      const result = evaluateEngagement(null, NOW);
      expect(result.status).toBe("NOT_MEASURABLE");
      expect(result.measurable).toBe(false);
      expect(result.score).toBeNull();
    });

    it("buckets by real recency windows", () => {
      const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
      expect(evaluateEngagement(daysAgo(5), NOW).status).toBe("HEALTHY");
      expect(evaluateEngagement(daysAgo(45), NOW).status).toBe("WATCH");
      expect(evaluateEngagement(daysAgo(75), NOW).status).toBe("AT_RISK");
      expect(evaluateEngagement(daysAgo(120), NOW).status).toBe("CRITICAL");
    });
  });

  describe("evaluateOnboardingHealth", () => {
    it("is NOT_MEASURABLE when no onboarding has started — a normal prospect state, not a penalty", () => {
      const result = evaluateOnboardingHealth({ status: null, createdAt: null, progressPercent: null }, NOW);
      expect(result.status).toBe("NOT_MEASURABLE");
      expect(result.measurable).toBe(false);
    });

    it("is HEALTHY once completed, regardless of progress percent", () => {
      expect(evaluateOnboardingHealth({ status: "COMPLETED", createdAt: NOW, progressPercent: 40 }, NOW).status).toBe("HEALTHY");
    });

    it("is AT_RISK when blocked", () => {
      expect(evaluateOnboardingHealth({ status: "BLOCKED", createdAt: NOW, progressPercent: 50 }, NOW).status).toBe("AT_RISK");
    });

    it("gives a freshly-started onboarding a 14-day grace window regardless of 0% progress", () => {
      const startedYesterday = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
      const result = evaluateOnboardingHealth({ status: "NOT_STARTED", createdAt: startedYesterday, progressPercent: 0 }, NOW);
      expect(result.status).toBe("HEALTHY");
    });

    it("judges by progress percentage once past the grace window", () => {
      const startedLongAgo = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
      expect(evaluateOnboardingHealth({ status: "IN_PROGRESS", createdAt: startedLongAgo, progressPercent: 80 }, NOW).status).toBe("HEALTHY");
      expect(evaluateOnboardingHealth({ status: "IN_PROGRESS", createdAt: startedLongAgo, progressPercent: 50 }, NOW).status).toBe("WATCH");
      expect(evaluateOnboardingHealth({ status: "IN_PROGRESS", createdAt: startedLongAgo, progressPercent: 10 }, NOW).status).toBe("AT_RISK");
    });

    it("is AT_RISK for a cancelled onboarding with no active replacement", () => {
      expect(evaluateOnboardingHealth({ status: "CANCELLED", createdAt: NOW, progressPercent: null }, NOW).status).toBe("AT_RISK");
    });
  });

  describe("evaluateProjectHealth / evaluateSupportHealth / evaluateServicePerformance — data honesty", () => {
    it("are always NOT_MEASURABLE, never fabricated, because their owning domains don't exist yet", () => {
      for (const fn of [evaluateProjectHealth, evaluateSupportHealth, evaluateServicePerformance]) {
        const result = fn(NOW);
        expect(result.status).toBe("NOT_MEASURABLE");
        expect(result.measurable).toBe(false);
        expect(result.score).toBeNull();
      }
    });
  });

  describe("toPaymentHealthComponent", () => {
    it("wraps an already-computed financial-health classification verbatim — no reimplemented formula", () => {
      const result = toPaymentHealthComponent("AT_RISK", ["Invoice INV-1 is 35 days overdue."]);
      expect(result.status).toBe("AT_RISK");
      expect(result.score).toBe(HEALTH_STATUS_SCORE.AT_RISK);
      expect(result.reason).toContain("35 days overdue");
    });

    it("is NOT_MEASURABLE when the caller passes that classification through (no billing account / no permission)", () => {
      const result = toPaymentHealthComponent("NOT_MEASURABLE", []);
      expect(result.measurable).toBe(false);
      expect(result.score).toBeNull();
    });
  });

  describe("evaluateChurnRisk", () => {
    const healthyPayment = component({ key: "payment", status: "HEALTHY", measurable: true, reason: "No overdue invoices." });
    const healthyOnboarding = component({ key: "onboarding", status: "HEALTHY", measurable: true, reason: "Completed." });
    const healthyEngagement = component({ key: "engagement", status: "HEALTHY", measurable: true, reason: "Active 3 days ago." });

    it("is UNKNOWN when literally nothing is measurable — never fabricated as LOW", () => {
      const result = evaluateChurnRisk({
        payment: component({ key: "payment", status: "NOT_MEASURABLE", measurable: false, score: null }),
        onboarding: component({ key: "onboarding", status: "NOT_MEASURABLE", measurable: false, score: null }),
        engagement: component({ key: "engagement", status: "NOT_MEASURABLE", measurable: false, score: null }),
        daysUntilContractExpiry: null,
        hasOpenRenewal: false,
      });
      expect(result.level).toBe("UNKNOWN");
      expect(result.reasons).toEqual([]);
    });

    it("is LOW when measurable and nothing is wrong", () => {
      const result = evaluateChurnRisk({ payment: healthyPayment, onboarding: healthyOnboarding, engagement: healthyEngagement, daysUntilContractExpiry: 200, hasOpenRenewal: false });
      expect(result.level).toBe("LOW");
      expect(result.reasons).toEqual([]);
    });

    it("is HIGH on a single CRITICAL-weight reason (payment CRITICAL) alone", () => {
      const result = evaluateChurnRisk({
        payment: component({ key: "payment", status: "CRITICAL", measurable: true, reason: "Suspended." }),
        onboarding: healthyOnboarding,
        engagement: healthyEngagement,
        daysUntilContractExpiry: 200,
        hasOpenRenewal: false,
      });
      expect(result.level).toBe("HIGH");
      expect(result.reasons.map((r) => r.code)).toContain("PAYMENT_OVERDUE");
      expect(result.reasons.find((r) => r.code === "PAYMENT_OVERDUE")?.critical).toBe(true);
    });

    it("is MEDIUM on exactly one non-critical reason (low engagement alone)", () => {
      const result = evaluateChurnRisk({
        payment: healthyPayment,
        onboarding: healthyOnboarding,
        engagement: component({ key: "engagement", status: "AT_RISK", measurable: true, reason: "75 days since last activity." }),
        daysUntilContractExpiry: 200,
        hasOpenRenewal: false,
      });
      expect(result.level).toBe("MEDIUM");
      expect(result.reasons.map((r) => r.code)).toEqual(["LOW_ENGAGEMENT"]);
    });

    it("is HIGH when two or more non-critical reasons stack", () => {
      const result = evaluateChurnRisk({
        payment: component({ key: "payment", status: "AT_RISK", measurable: true, reason: "30 days overdue." }),
        onboarding: healthyOnboarding,
        engagement: component({ key: "engagement", status: "AT_RISK", measurable: true, reason: "75 days since last activity." }),
        daysUntilContractExpiry: 200,
        hasOpenRenewal: false,
      });
      expect(result.level).toBe("HIGH");
      expect(result.reasons.length).toBe(2);
    });

    it("flags CONTRACT_EXPIRING only when no open renewal already tracks it, and escalates to critical inside 7 days", () => {
      const withoutRenewal = evaluateChurnRisk({ payment: healthyPayment, onboarding: healthyOnboarding, engagement: healthyEngagement, daysUntilContractExpiry: 20, hasOpenRenewal: false });
      expect(withoutRenewal.reasons.map((r) => r.code)).toContain("CONTRACT_EXPIRING");

      const withRenewal = evaluateChurnRisk({ payment: healthyPayment, onboarding: healthyOnboarding, engagement: healthyEngagement, daysUntilContractExpiry: 20, hasOpenRenewal: true });
      expect(withRenewal.reasons.map((r) => r.code)).not.toContain("CONTRACT_EXPIRING");
      expect(withRenewal.level).toBe("LOW");

      const critical = evaluateChurnRisk({ payment: healthyPayment, onboarding: healthyOnboarding, engagement: healthyEngagement, daysUntilContractExpiry: 5, hasOpenRenewal: false });
      expect(critical.level).toBe("HIGH");
      expect(critical.reasons.find((r) => r.code === "CONTRACT_EXPIRING")?.critical).toBe(true);
    });

    it("flags an already-expired contract with no open renewal as a critical-weight reason", () => {
      const result = evaluateChurnRisk({ payment: healthyPayment, onboarding: healthyOnboarding, engagement: healthyEngagement, daysUntilContractExpiry: -10, hasOpenRenewal: false });
      expect(result.level).toBe("HIGH");
      expect(result.reasons.map((r) => r.code)).toContain("CONTRACT_EXPIRED_UNRESOLVED");
    });

    it("never fabricates a contract-expiry reason when no active contract with a known end date exists", () => {
      const result = evaluateChurnRisk({ payment: healthyPayment, onboarding: healthyOnboarding, engagement: healthyEngagement, daysUntilContractExpiry: null, hasOpenRenewal: false });
      expect(result.reasons.map((r) => r.code)).not.toContain("CONTRACT_EXPIRING");
      expect(result.reasons.map((r) => r.code)).not.toContain("CONTRACT_EXPIRED_UNRESOLVED");
    });
  });
});
