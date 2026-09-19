/**
 * `GhlAsset` implementation lifecycle (Build 34 — Roadmap Module 28). A
 * genuinely SEPARATE state machine from `EcommerceProductStatus` (Build
 * 33) and `WebsitePageStatus` (Build 32) — never a shared import, per
 * every prior specialist domain's own "never share types across domains
 * merely because they look similar" discipline (see website-development-os.md
 * "Separation from SEO OS/Local SEO"). This one adds an explicit
 * `QA_FAILED` state neither sibling domain needed: GHL automation
 * implementation work (a workflow trigger misfiring, a calendar booking
 * flow breaking) genuinely fails QA in a way that's common enough to
 * deserve its own named state and an explicit rework loop back to
 * `IN_PROGRESS`, rather than silently folding back into `READY_FOR_QA`.
 */
export type GhlAssetImplementationStatus = "PLANNED" | "IN_PROGRESS" | "READY_FOR_QA" | "QA_FAILED" | "READY" | "LIVE" | "ARCHIVED";

const GHL_ASSET_TRANSITIONS: Record<GhlAssetImplementationStatus, GhlAssetImplementationStatus[]> = {
  PLANNED: ["IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["READY_FOR_QA", "ARCHIVED"],
  READY_FOR_QA: ["IN_PROGRESS", "QA_FAILED", "READY", "ARCHIVED"],
  QA_FAILED: ["IN_PROGRESS", "ARCHIVED"],
  READY: ["IN_PROGRESS", "LIVE", "ARCHIVED"],
  LIVE: ["IN_PROGRESS", "ARCHIVED"],
  ARCHIVED: ["IN_PROGRESS"],
};

/** Statuses that count as "complete" for the readiness formula's own required-asset component — an asset doesn't need to already be LIVE (impossible before the workspace itself goes live) to count as implementation-ready. */
export const GHL_ASSET_READY_STATUSES: GhlAssetImplementationStatus[] = ["READY", "LIVE"];

export function canTransitionGhlAsset(from: GhlAssetImplementationStatus, to: GhlAssetImplementationStatus): boolean {
  return GHL_ASSET_TRANSITIONS[from].includes(to);
}
