import type { ProjectProgress, PortalProgress } from "@/lib/projects/progress";

/**
 * Server-calculated progress, rendered exactly as computed — never a
 * client-editable percentage. Mirrors `OnboardingProgressDisplay`'s own
 * shape/convention (Build 23). Accepts either the full internal
 * `ProjectProgress` (admin UI — shows the "N/M" fraction) or the
 * Portal's own count-free `PortalProgress` (Customer Portal — percent
 * only, see `toPortalProgress()`'s own doc comment for why).
 */
export function ProjectProgressDisplay({ progress, label = "Progress" }: { progress: ProjectProgress | PortalProgress; label?: string }) {
  if (progress.kind === "NOT_MEASURABLE") {
    return <p className="text-sm text-muted-foreground">Not measurable yet — no eligible tasks.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{progress.percent}%{"completed" in progress ? ` (${progress.completed}/${progress.eligible})` : ""}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}
