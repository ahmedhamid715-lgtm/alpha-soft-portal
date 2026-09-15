import { describe, expect, it } from "vitest";
import {
  computeCustomerHealth,
  evaluateEngagement,
  evaluateOnboardingHealth,
  evaluateProjectHealth,
  evaluateSupportHealth,
  evaluateServicePerformance,
  classifySeoServicePerformance,
  classifyLocalSeoServicePerformance,
  classifyWebsiteServicePerformance,
  toPaymentHealthComponent,
  evaluateChurnRisk,
  HEALTH_STATUS_SCORE,
  type HealthComponent,
  type ProjectHealthInput,
  type ServicePerformanceInput,
  type SeoServicePerformanceInput,
  type LocalSeoServicePerformanceInput,
  type WebsiteServicePerformanceInput,
  type SpecialistServicePerformanceInput,
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

  describe("evaluateSupportHealth — data honesty", () => {
    it("is always NOT_MEASURABLE, never fabricated, because Support Center (Roadmap 30) doesn't exist yet", () => {
      const result = evaluateSupportHealth(NOW);
      expect(result.status).toBe("NOT_MEASURABLE");
      expect(result.measurable).toBe(false);
      expect(result.score).toBeNull();
    });
  });

  describe("classifySeoServicePerformance (Build 30 — SEO OS graduation)", () => {
    function seoInput(overrides: Partial<SeoServicePerformanceInput>): SeoServicePerformanceInput {
      return { observedKeywordCount: 10, improvingKeywordCount: 0, decliningKeywordCount: 0, openCriticalIssueCount: 0, openWarningIssueCount: 0, ...overrides };
    }

    it("is NOT_MEASURABLE when input is null, or zero keywords have ever been observed — never fabricated", () => {
      expect(classifySeoServicePerformance("cs-1", null).status).toBe("NOT_MEASURABLE");
      expect(classifySeoServicePerformance("cs-1", null).measurable).toBe(false);
      expect(classifySeoServicePerformance("cs-1", seoInput({ observedKeywordCount: 0 })).status).toBe("NOT_MEASURABLE");
    });

    it("is HEALTHY when there are no open critical/warning issues and rankings are stable or improving", () => {
      const result = classifySeoServicePerformance("cs-1", seoInput({}));
      expect(result.status).toBe("HEALTHY");
      expect(result.measurable).toBe(true);
      expect(classifySeoServicePerformance("cs-1", seoInput({ improvingKeywordCount: 3, decliningKeywordCount: 1 })).status).toBe("HEALTHY");
    });

    it("is WATCH when declines equal gains, or an open warning issue exists", () => {
      expect(classifySeoServicePerformance("cs-1", seoInput({ improvingKeywordCount: 2, decliningKeywordCount: 2 })).status).toBe("WATCH");
      expect(classifySeoServicePerformance("cs-1", seoInput({ openWarningIssueCount: 1 })).status).toBe("WATCH");
    });

    it("is AT_RISK when more keywords declined than improved", () => {
      expect(classifySeoServicePerformance("cs-1", seoInput({ improvingKeywordCount: 1, decliningKeywordCount: 3 })).status).toBe("AT_RISK");
    });

    it("is CRITICAL when any critical issue is open — outranks everything else", () => {
      expect(classifySeoServicePerformance("cs-1", seoInput({ openCriticalIssueCount: 1 })).status).toBe("CRITICAL");
      expect(classifySeoServicePerformance("cs-1", seoInput({ openCriticalIssueCount: 1, improvingKeywordCount: 5, decliningKeywordCount: 0 })).status).toBe("CRITICAL");
    });
  });

  describe("classifyLocalSeoServicePerformance (Build 31 — GBP / Local SEO)", () => {
    function localSeoInput(overrides: Partial<LocalSeoServicePerformanceInput>): LocalSeoServicePerformanceInput {
      return { observedKeywordCount: 10, improvingKeywordCount: 0, decliningKeywordCount: 0, openCriticalIssueCount: 0, openWarningIssueCount: 0, inconsistentListingCount: 0, measurableListingCount: 2, ...overrides };
    }

    it("is NOT_MEASURABLE when input is null, or zero keywords AND zero measurable listings — never fabricated", () => {
      expect(classifyLocalSeoServicePerformance("cs-1", null).status).toBe("NOT_MEASURABLE");
      expect(classifyLocalSeoServicePerformance("cs-1", null).measurable).toBe(false);
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ observedKeywordCount: 0, measurableListingCount: 0 })).status).toBe("NOT_MEASURABLE");
    });

    it("is measurable from listings alone even with zero observed keywords", () => {
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ observedKeywordCount: 0, measurableListingCount: 3 })).measurable).toBe(true);
    });

    it("is HEALTHY when no open issues, no inconsistent listings, and rankings are stable or improving", () => {
      const result = classifyLocalSeoServicePerformance("cs-1", localSeoInput({}));
      expect(result.status).toBe("HEALTHY");
      expect(result.measurable).toBe(true);
    });

    it("is AT_RISK when any listing is NAP-inconsistent, or more keywords declined than improved", () => {
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ inconsistentListingCount: 1 })).status).toBe("AT_RISK");
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ improvingKeywordCount: 1, decliningKeywordCount: 3 })).status).toBe("AT_RISK");
    });

    it("is WATCH when declines equal gains, or an open warning issue exists", () => {
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ improvingKeywordCount: 2, decliningKeywordCount: 2 })).status).toBe("WATCH");
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ openWarningIssueCount: 1 })).status).toBe("WATCH");
    });

    it("is CRITICAL when any critical issue is open — outranks everything else, including inconsistent listings", () => {
      expect(classifyLocalSeoServicePerformance("cs-1", localSeoInput({ openCriticalIssueCount: 1, inconsistentListingCount: 1 })).status).toBe("CRITICAL");
    });

    it("never includes review data in the pass/fail formula (reviews are a separate KPI, not a Service Performance input)", () => {
      // LocalSeoServicePerformanceInput has no review fields at all — this
      // test documents the deliberate omission (see the type's own doc
      // comment) rather than exercising a field that doesn't exist.
      const input = localSeoInput({});
      expect(Object.keys(input)).not.toContain("reviewCount");
      expect(Object.keys(input)).not.toContain("averageRating");
    });
  });

  describe("classifyWebsiteServicePerformance (Build 32 — Website Development OS)", () => {
    function websiteInput(overrides: Partial<WebsiteServicePerformanceInput>): WebsiteServicePerformanceInput {
      return { activeSiteCount: 1, anyReadinessNotReady: false, anyOverdueUnlaunchedSite: false, nearestUpcomingLaunchTargetDate: null, linkedProjectStatus: null, requiredQaFailedCount: 0, requiredQaPendingCount: 0, ...overrides };
    }

    it("is NOT_MEASURABLE when input is null, or zero active sites — never fabricated", () => {
      expect(classifyWebsiteServicePerformance("cs-1", null).status).toBe("NOT_MEASURABLE");
      expect(classifyWebsiteServicePerformance("cs-1", null).measurable).toBe(false);
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ activeSiteCount: 0 })).status).toBe("NOT_MEASURABLE");
    });

    it("is HEALTHY when there are no overdue/at-risk sites and no failed/pending required QA", () => {
      const result = classifyWebsiteServicePerformance("cs-1", websiteInput({}));
      expect(result.status).toBe("HEALTHY");
      expect(result.measurable).toBe(true);
    });

    it("is CRITICAL when any required QA check has failed — outranks everything else", () => {
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ requiredQaFailedCount: 1 })).status).toBe("CRITICAL");
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ requiredQaFailedCount: 1, anyOverdueUnlaunchedSite: true })).status).toBe("CRITICAL");
    });

    it("is CRITICAL when a site's launch target date has passed without a recorded launch", () => {
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ anyOverdueUnlaunchedSite: true })).status).toBe("CRITICAL");
    });

    it("is AT_RISK when the linked project is CANCELLED or ON_HOLD", () => {
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ linkedProjectStatus: "CANCELLED" })).status).toBe("AT_RISK");
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ linkedProjectStatus: "ON_HOLD" })).status).toBe("AT_RISK");
    });

    it("is AT_RISK when not launch-ready and the nearest launch target is within the 14-day warning window", () => {
      const soon = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
      const result = classifyWebsiteServicePerformance("cs-1", websiteInput({ anyReadinessNotReady: true, nearestUpcomingLaunchTargetDate: soon }), NOW);
      expect(result.status).toBe("AT_RISK");
    });

    it("is WATCH when not launch-ready but the launch target is far away (or unset)", () => {
      const far = new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000);
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ anyReadinessNotReady: true, nearestUpcomingLaunchTargetDate: far }), NOW).status).toBe("WATCH");
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ anyReadinessNotReady: true, nearestUpcomingLaunchTargetDate: null })).status).toBe("WATCH");
    });

    it("is WATCH when required QA is still pending", () => {
      expect(classifyWebsiteServicePerformance("cs-1", websiteInput({ requiredQaPendingCount: 2 })).status).toBe("WATCH");
    });

    it("never counts missing/zero QA data as a failure — zero required QA checks is not penalized", () => {
      const result = classifyWebsiteServicePerformance("cs-1", websiteInput({ requiredQaFailedCount: 0, requiredQaPendingCount: 0 }));
      expect(result.status).toBe("HEALTHY");
    });
  });

  describe("evaluateServicePerformance — multi-specialist aggregation (Build 31, extended Build 32)", () => {
    const seoHealthy: SpecialistServicePerformanceInput = { customerServiceId: "cs-seo", category: "SEO", measurable: true, status: "HEALTHY", reason: "SEO healthy." };
    const seoCritical: SpecialistServicePerformanceInput = { customerServiceId: "cs-seo", category: "SEO", measurable: true, status: "CRITICAL", reason: "SEO critical." };
    const seoNotMeasurable: SpecialistServicePerformanceInput = { customerServiceId: "cs-seo", category: "SEO", measurable: false, status: "NOT_MEASURABLE", reason: "SEO not measurable." };
    const localSeoHealthy: SpecialistServicePerformanceInput = { customerServiceId: "cs-local", category: "LOCAL_SEO", measurable: true, status: "HEALTHY", reason: "Local SEO healthy." };
    const localSeoAtRisk: SpecialistServicePerformanceInput = { customerServiceId: "cs-local", category: "LOCAL_SEO", measurable: true, status: "AT_RISK", reason: "Local SEO at risk." };
    const localSeoNotMeasurable: SpecialistServicePerformanceInput = { customerServiceId: "cs-local", category: "LOCAL_SEO", measurable: false, status: "NOT_MEASURABLE", reason: "Local SEO not measurable." };
    const websiteHealthy: SpecialistServicePerformanceInput = { customerServiceId: "cs-website", category: "WEB_DEVELOPMENT", measurable: true, status: "HEALTHY", reason: "Website Development healthy." };
    const websiteCritical: SpecialistServicePerformanceInput = { customerServiceId: "cs-website", category: "WEB_DEVELOPMENT", measurable: true, status: "CRITICAL", reason: "Website Development critical." };
    const websiteNotMeasurable: SpecialistServicePerformanceInput = { customerServiceId: "cs-website", category: "WEB_DEVELOPMENT", measurable: false, status: "NOT_MEASURABLE", reason: "Website Development not measurable." };

    function input(specialists: SpecialistServicePerformanceInput[]): ServicePerformanceInput {
      return { specialists };
    }

    it("is NOT_MEASURABLE when input is null, or the specialists array is empty — no specialist services at all", () => {
      expect(evaluateServicePerformance(null, NOW).status).toBe("NOT_MEASURABLE");
      expect(evaluateServicePerformance(input([]), NOW).status).toBe("NOT_MEASURABLE");
    });

    it("SEO only, measurable — reflects SEO's own status", () => {
      expect(evaluateServicePerformance(input([seoHealthy]), NOW).status).toBe("HEALTHY");
      expect(evaluateServicePerformance(input([seoCritical]), NOW).status).toBe("CRITICAL");
    });

    it("Local SEO only, measurable — reflects Local SEO's own status", () => {
      expect(evaluateServicePerformance(input([localSeoHealthy]), NOW).status).toBe("HEALTHY");
      expect(evaluateServicePerformance(input([localSeoAtRisk]), NOW).status).toBe("AT_RISK");
    });

    it("SEO + Local SEO both measurable — takes the WORST status among them", () => {
      expect(evaluateServicePerformance(input([seoHealthy, localSeoAtRisk]), NOW).status).toBe("AT_RISK");
      expect(evaluateServicePerformance(input([seoCritical, localSeoHealthy]), NOW).status).toBe("CRITICAL");
    });

    it("SEO measurable, Local SEO NOT_MEASURABLE — the NOT_MEASURABLE specialist is excluded, not counted as failing", () => {
      const result = evaluateServicePerformance(input([seoHealthy, localSeoNotMeasurable]), NOW);
      expect(result.status).toBe("HEALTHY");
      expect(result.measurable).toBe(true);
      expect(result.reason).not.toContain("not measurable");
    });

    it("Local SEO measurable, SEO NOT_MEASURABLE — the NOT_MEASURABLE specialist is excluded, not counted as failing", () => {
      const result = evaluateServicePerformance(input([localSeoAtRisk, seoNotMeasurable]), NOW);
      expect(result.status).toBe("AT_RISK");
      expect(result.measurable).toBe(true);
    });

    it("no specialist measurements at all (both NOT_MEASURABLE) — NOT_MEASURABLE, never a fabricated score", () => {
      const result = evaluateServicePerformance(input([seoNotMeasurable, localSeoNotMeasurable]), NOW);
      expect(result.status).toBe("NOT_MEASURABLE");
      expect(result.measurable).toBe(false);
      expect(result.score).toBeNull();
    });

    it("multiple active specialist services — deterministic worst-status-wins regardless of array order", () => {
      const a = evaluateServicePerformance(input([seoHealthy, localSeoAtRisk, seoCritical]), NOW);
      const b = evaluateServicePerformance(input([seoCritical, seoHealthy, localSeoAtRisk]), NOW);
      expect(a.status).toBe("CRITICAL");
      expect(b.status).toBe("CRITICAL");
      expect(a.score).toBe(HEALTH_STATUS_SCORE.CRITICAL);
    });

    it("Website Development only, measurable — reflects Website Development's own status (Build 32 regression)", () => {
      expect(evaluateServicePerformance(input([websiteHealthy]), NOW).status).toBe("HEALTHY");
      expect(evaluateServicePerformance(input([websiteCritical]), NOW).status).toBe("CRITICAL");
    });

    it("SEO + Website Development both measurable — takes the WORST status among them", () => {
      expect(evaluateServicePerformance(input([seoHealthy, websiteCritical]), NOW).status).toBe("CRITICAL");
      expect(evaluateServicePerformance(input([seoCritical, websiteHealthy]), NOW).status).toBe("CRITICAL");
    });

    it("Local SEO + Website Development both measurable — takes the WORST status among them", () => {
      expect(evaluateServicePerformance(input([localSeoAtRisk, websiteHealthy]), NOW).status).toBe("AT_RISK");
      expect(evaluateServicePerformance(input([localSeoHealthy, websiteCritical]), NOW).status).toBe("CRITICAL");
    });

    it("all three specialists (SEO + Local SEO + Website Development) — worst status wins regardless of order", () => {
      const a = evaluateServicePerformance(input([seoHealthy, localSeoHealthy, websiteCritical]), NOW);
      const b = evaluateServicePerformance(input([websiteCritical, seoHealthy, localSeoHealthy]), NOW);
      expect(a.status).toBe("CRITICAL");
      expect(b.status).toBe("CRITICAL");
    });

    it("one measurable (Website Development), others NOT_MEASURABLE — reflects the one measurable specialist only", () => {
      const result = evaluateServicePerformance(input([websiteHealthy, seoNotMeasurable, localSeoNotMeasurable]), NOW);
      expect(result.status).toBe("HEALTHY");
      expect(result.measurable).toBe(true);
    });

    it("none measurable across all three specialists — NOT_MEASURABLE, never a fabricated score", () => {
      const result = evaluateServicePerformance(input([seoNotMeasurable, localSeoNotMeasurable, websiteNotMeasurable]), NOW);
      expect(result.status).toBe("NOT_MEASURABLE");
      expect(result.measurable).toBe(false);
      expect(result.score).toBeNull();
    });
  });

  describe("evaluateProjectHealth (Build 27 — Roadmap Module 21)", () => {
    function projectInput(overrides: Partial<ProjectHealthInput>): ProjectHealthInput {
      return { activeProjectCount: 1, onHoldProjectCount: 0, overdueRequiredTaskCount: 0, blockedRequiredTaskCount: 0, pastTargetDateProjectCount: 0, approachingTargetDateProjectCount: 0, failedRequiredQaCount: 0, ...overrides };
    }

    it("is NOT_MEASURABLE when input is null (no linked organization / no permission) or there are zero active projects", () => {
      expect(evaluateProjectHealth(null, NOW).status).toBe("NOT_MEASURABLE");
      expect(evaluateProjectHealth(projectInput({ activeProjectCount: 0 }), NOW).status).toBe("NOT_MEASURABLE");
    });

    it("is HEALTHY when there is active delivery work with no overdue/blocked/failed signals", () => {
      const result = evaluateProjectHealth(projectInput({}), NOW);
      expect(result.status).toBe("HEALTHY");
      expect(result.measurable).toBe(true);
      expect(result.score).toBe(HEALTH_STATUS_SCORE.HEALTHY);
    });

    it("is WATCH when a project's target end date approaches within 14 days with no other issues", () => {
      expect(evaluateProjectHealth(projectInput({ approachingTargetDateProjectCount: 1 }), NOW).status).toBe("WATCH");
    });

    it("is AT_RISK for an on-hold project, an overdue required task, or a blocked required task", () => {
      expect(evaluateProjectHealth(projectInput({ onHoldProjectCount: 1 }), NOW).status).toBe("AT_RISK");
      expect(evaluateProjectHealth(projectInput({ overdueRequiredTaskCount: 1 }), NOW).status).toBe("AT_RISK");
      expect(evaluateProjectHealth(projectInput({ blockedRequiredTaskCount: 1 }), NOW).status).toBe("AT_RISK");
    });

    it("is CRITICAL for a failed required QA check, a project past its target end date, or 3+ overdue required tasks", () => {
      expect(evaluateProjectHealth(projectInput({ failedRequiredQaCount: 1 }), NOW).status).toBe("CRITICAL");
      expect(evaluateProjectHealth(projectInput({ pastTargetDateProjectCount: 1 }), NOW).status).toBe("CRITICAL");
      expect(evaluateProjectHealth(projectInput({ overdueRequiredTaskCount: 3 }), NOW).status).toBe("CRITICAL");
    });

    it("checks in highest-severity-first order — a failed QA check outranks a merely-approaching target date", () => {
      expect(evaluateProjectHealth(projectInput({ failedRequiredQaCount: 1, approachingTargetDateProjectCount: 1 }), NOW).status).toBe("CRITICAL");
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
