/**
 * Deterministic onboarding progress/completion math (Build 23 — Roadmap
 * Module 17) — the ONE place these calculations live, mirroring
 * `proposal-pricing.ts`'s own "pure, isomorphic, server-authoritative"
 * discipline from Build 22. Never let the client submit an arbitrary
 * percentage or a `COMPLETED` flag directly — both are always
 * recalculated here from the actual persisted state.
 */

export type OnboardingProgress = { kind: "NOT_MEASURABLE" } | { kind: "MEASURED"; percent: number };

/**
 * Progress formula: completed REQUIRED checklist items / total REQUIRED
 * checklist items. Requirements and intake are completion GATES (see
 * `evaluateCompletionCriteria()` below), not part of this percentage —
 * keeps the number legible ("how much of the actual delivery checklist
 * is done") rather than an opaque blend of unrelated concepts.
 *
 * If there are no required checklist items at all, a fabricated `0%`
 * would be actively misleading (it reads as "nothing done" when there is
 * nothing TO measure) — `NOT_MEASURABLE` is the honest state instead.
 */
export function calculateProgress(checklistItems: { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[]): OnboardingProgress {
  const required = checklistItems.filter((item) => item.required);
  if (required.length === 0) return { kind: "NOT_MEASURABLE" };
  const completed = required.filter((item) => item.status === "COMPLETE").length;
  return { kind: "MEASURED", percent: Math.round((completed / required.length) * 100) };
}

export interface CompletionCriteriaInput {
  intakeFields: { id: string; required: boolean }[];
  intakeResponses: { fieldId: string; value: string | null }[];
  requirements: { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[];
  checklistItems: { required: boolean; status: "PENDING" | "IN_PROGRESS" | "COMPLETE" }[];
  /** Whether a kickoff was ever scheduled — an onboarding that never scheduled one doesn't block completion on it (see this module's own top comment: completion criteria only apply to work that was actually asked for). */
  kickoffScheduledAt: Date | null;
  kickoffCompletedAt: Date | null;
}

export interface CompletionCriteriaResult {
  met: boolean;
  /** Which specific gate(s) are still open — surfaced to the UI so "why can't I complete this" is always answerable, never a bare boolean. */
  unmet: ("INTAKE" | "REQUIREMENTS" | "CHECKLIST" | "KICKOFF")[];
}

/**
 * Completion criteria (decision #20): all REQUIRED intake fields
 * answered (a non-null, non-empty-string value recorded) + all REQUIRED
 * requirements COMPLETE + all REQUIRED checklist items COMPLETE +
 * kickoff completed ONLY IF one was actually scheduled. Optional items
 * are never required for completion — a privileged
 * `completionOverride` (see `crm.onboarding.complete`) is the only way
 * to bypass an unmet gate, and that path is handled entirely at the
 * service layer (this function only ever reports the TRUE criteria
 * state, never the override).
 */
export function evaluateCompletionCriteria(input: CompletionCriteriaInput): CompletionCriteriaResult {
  const unmet: CompletionCriteriaResult["unmet"] = [];

  // Every REQUIRED field's own id must have a non-empty response — checked
  // precisely by id, never by aggregate count (a field can't be required,
  // its FIELD definition is; an optional field's own answer must never be
  // mistaken for a required one just because the counts happen to line up).
  const answeredFieldIds = new Set(input.intakeResponses.filter((r) => r.value !== null && r.value.trim() !== "").map((r) => r.fieldId));
  const requiredFields = input.intakeFields.filter((f) => f.required);
  if (requiredFields.some((field) => !answeredFieldIds.has(field.id))) unmet.push("INTAKE");

  if (input.requirements.some((r) => r.required && r.status !== "COMPLETE")) unmet.push("REQUIREMENTS");
  if (input.checklistItems.some((c) => c.required && c.status !== "COMPLETE")) unmet.push("CHECKLIST");
  if (input.kickoffScheduledAt !== null && input.kickoffCompletedAt === null) unmet.push("KICKOFF");

  return { met: unmet.length === 0, unmet };
}

/** Whether every required item is done and no kickoff has been scheduled yet — the exact "ready for kickoff" notification trigger (decision #26), distinct from full completion (which also requires the kickoff itself to be done, if scheduled). */
export function isReadyForKickoff(criteria: CompletionCriteriaResult, kickoffScheduledAt: Date | null): boolean {
  const nonKickoffGatesMet = criteria.unmet.filter((gate) => gate !== "KICKOFF").length === 0;
  return nonKickoffGatesMet && kickoffScheduledAt === null;
}
