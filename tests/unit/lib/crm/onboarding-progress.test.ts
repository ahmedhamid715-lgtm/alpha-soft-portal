import { describe, expect, it } from "vitest";
import { calculateProgress, evaluateCompletionCriteria, isReadyForKickoff } from "@/lib/crm/onboarding-progress";

describe("onboarding-progress", () => {
  describe("calculateProgress", () => {
    it("returns NOT_MEASURABLE when there are no required checklist items", () => {
      expect(calculateProgress([])).toEqual({ kind: "NOT_MEASURABLE" });
      expect(calculateProgress([{ required: false, status: "COMPLETE" }])).toEqual({ kind: "NOT_MEASURABLE" });
    });

    it("computes the percentage of required items completed, ignoring optional items", () => {
      const items: { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[] = [
        { required: true, status: "COMPLETE" },
        { required: true, status: "PENDING" },
        { required: false, status: "PENDING" },
      ];
      expect(calculateProgress(items)).toEqual({ kind: "MEASURED", percent: 50 });
    });

    it("returns 100% when every required item is complete", () => {
      const items: { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[] = [
        { required: true, status: "COMPLETE" },
        { required: true, status: "COMPLETE" },
      ];
      expect(calculateProgress(items)).toEqual({ kind: "MEASURED", percent: 100 });
    });

    it("returns 0% when no required item is complete — never fabricated, genuinely computed", () => {
      const items: { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[] = [{ required: true, status: "PENDING" }];
      expect(calculateProgress(items)).toEqual({ kind: "MEASURED", percent: 0 });
    });
  });

  describe("evaluateCompletionCriteria", () => {
    const base = {
      intakeFields: [] as { id: string; required: boolean }[],
      intakeResponses: [] as { fieldId: string; value: string | null }[],
      requirements: [] as { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[],
      checklistItems: [] as { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[],
      kickoffScheduledAt: null as Date | null,
      kickoffCompletedAt: null as Date | null,
    };

    it("is met when there is nothing required anywhere", () => {
      expect(evaluateCompletionCriteria(base)).toEqual({ met: true, unmet: [] });
    });

    it("flags INTAKE when a required field has no response by id, even if an optional field's answer would satisfy a naive count check", () => {
      const result = evaluateCompletionCriteria({
        ...base,
        intakeFields: [
          { id: "required-field", required: true },
          { id: "optional-field", required: false },
        ],
        intakeResponses: [{ fieldId: "optional-field", value: "answered" }],
      });
      expect(result.met).toBe(false);
      expect(result.unmet).toContain("INTAKE");
    });

    it("does not flag INTAKE once the required field itself has a non-empty response", () => {
      const result = evaluateCompletionCriteria({
        ...base,
        intakeFields: [{ id: "required-field", required: true }],
        intakeResponses: [{ fieldId: "required-field", value: "answered" }],
      });
      expect(result.unmet).not.toContain("INTAKE");
    });

    it("treats a whitespace-only or null response as unanswered", () => {
      const result = evaluateCompletionCriteria({
        ...base,
        intakeFields: [{ id: "required-field", required: true }],
        intakeResponses: [{ fieldId: "required-field", value: "   " }],
      });
      expect(result.unmet).toContain("INTAKE");
    });

    it("flags REQUIREMENTS when a required requirement is not COMPLETE, ignores optional ones", () => {
      const result = evaluateCompletionCriteria({
        ...base,
        requirements: [
          { required: true, status: "PENDING" },
          { required: false, status: "PENDING" },
        ],
      });
      expect(result.unmet).toEqual(["REQUIREMENTS"]);
    });

    it("flags CHECKLIST when a required checklist item is not COMPLETE", () => {
      const result = evaluateCompletionCriteria({ ...base, checklistItems: [{ required: true, status: "IN_PROGRESS" }] });
      expect(result.unmet).toEqual(["CHECKLIST"]);
    });

    it("does not flag KICKOFF when no kickoff was ever scheduled", () => {
      const result = evaluateCompletionCriteria({ ...base, kickoffScheduledAt: null, kickoffCompletedAt: null });
      expect(result.unmet).not.toContain("KICKOFF");
    });

    it("flags KICKOFF when scheduled but not yet completed", () => {
      const result = evaluateCompletionCriteria({ ...base, kickoffScheduledAt: new Date(), kickoffCompletedAt: null });
      expect(result.unmet).toEqual(["KICKOFF"]);
    });

    it("does not flag KICKOFF once completed", () => {
      const result = evaluateCompletionCriteria({ ...base, kickoffScheduledAt: new Date(), kickoffCompletedAt: new Date() });
      expect(result.unmet).not.toContain("KICKOFF");
    });

    it("reports every unmet gate simultaneously, not just the first one found", () => {
      const result = evaluateCompletionCriteria({
        ...base,
        intakeFields: [{ id: "f1", required: true }],
        intakeResponses: [],
        requirements: [{ required: true, status: "PENDING" }],
        checklistItems: [{ required: true, status: "PENDING" }],
        kickoffScheduledAt: new Date(),
        kickoffCompletedAt: null,
      });
      expect(result.met).toBe(false);
      expect(result.unmet).toEqual(["INTAKE", "REQUIREMENTS", "CHECKLIST", "KICKOFF"]);
    });
  });

  describe("isReadyForKickoff", () => {
    it("is true once every non-kickoff gate is met and no kickoff has been scheduled", () => {
      expect(isReadyForKickoff({ met: false, unmet: ["KICKOFF"] }, null)).toBe(true);
    });

    it("is false if a kickoff was already scheduled", () => {
      expect(isReadyForKickoff({ met: false, unmet: ["KICKOFF"] }, new Date())).toBe(false);
    });

    it("is false while another gate besides kickoff is still unmet", () => {
      expect(isReadyForKickoff({ met: false, unmet: ["CHECKLIST", "KICKOFF"] }, null)).toBe(false);
    });

    it("is true when every other gate is met and kickoff genuinely was never scheduled — the exact definition of 'ready for kickoff'", () => {
      expect(isReadyForKickoff({ met: true, unmet: [] }, null)).toBe(true);
    });
  });
});
