import type { OnboardingProgress, CompletionCriteriaResult } from "@/lib/crm/onboarding-progress";

const GATE_LABELS: Record<CompletionCriteriaResult["unmet"][number], string> = {
  INTAKE: "Required intake fields",
  REQUIREMENTS: "Required requirements",
  CHECKLIST: "Required checklist items",
  KICKOFF: "Kickoff",
};

/** Server-calculated progress/completion state, rendered exactly as computed — never a client-editable percentage (see `onboarding-progress.ts`'s own top comment). */
export function OnboardingProgressDisplay({ progress, completion }: { progress: OnboardingProgress; completion: CompletionCriteriaResult }) {
  return (
    <div className="flex flex-col gap-2">
      {progress.kind === "NOT_MEASURABLE" ? (
        <p className="text-sm text-muted-foreground">Not measurable yet — add required checklist items to track progress.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Checklist progress</span>
            <span className="font-medium tabular-nums">{progress.percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Onboarding checklist progress">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}
      {!completion.met ? (
        <p className="text-xs text-muted-foreground">
          Not yet ready to complete — outstanding: {completion.unmet.map((gate) => GATE_LABELS[gate]).join(", ")}.
        </p>
      ) : (
        <p className="text-xs text-success">All required work is done — ready to complete.</p>
      )}
    </div>
  );
}
