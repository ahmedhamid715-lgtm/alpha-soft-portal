/**
 * `WebsitePage` lifecycle state machine (Build 32 — Roadmap Module 26).
 * Deliberately NOT a copy of `ProjectTask`'s own status machine —
 * `WebsitePageStatus` describes website-DELIVERABLE state (this specific
 * page/template's own readiness for launch), never general task-work
 * state (which stays ProjectTask's own concern). Neither `READY_FOR_
 * LAUNCH` nor `ARCHIVED` is truly terminal — a page can be pulled back
 * for rework after passing QA, revised after going live, or restored
 * after being archived.
 */
export type WebsitePageStatus = "PLANNED" | "IN_PROGRESS" | "QA" | "READY_FOR_LAUNCH" | "LIVE" | "ARCHIVED";

const WEBSITE_PAGE_TRANSITIONS: Record<WebsitePageStatus, WebsitePageStatus[]> = {
  PLANNED: ["IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["QA", "ARCHIVED"],
  QA: ["IN_PROGRESS", "READY_FOR_LAUNCH", "ARCHIVED"],
  READY_FOR_LAUNCH: ["IN_PROGRESS", "LIVE", "ARCHIVED"],
  LIVE: ["IN_PROGRESS", "ARCHIVED"],
  ARCHIVED: ["IN_PROGRESS"],
};

/** Statuses that count as "complete" for the launch-readiness formula's own required-page component — a page doesn't need to already be LIVE (impossible before the site itself launches) to count as delivery-ready. */
export const WEBSITE_PAGE_READY_STATUSES: WebsitePageStatus[] = ["READY_FOR_LAUNCH", "LIVE"];

export function canTransitionWebsitePage(from: WebsitePageStatus, to: WebsitePageStatus): boolean {
  return WEBSITE_PAGE_TRANSITIONS[from].includes(to);
}
