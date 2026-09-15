/**
 * `LocalSeoIssue` lifecycle state machine (Build 31 — Roadmap Module
 * 25). Identical shape/reasoning to `src/lib/seo/issue-lifecycle.ts`
 * (Build 30) — neither RESOLVED nor IGNORED is truly terminal; a real
 * NAP inconsistency or missing listing can recur after being fixed,
 * and staff can always decide an ignored issue deserves attention
 * after all. Both re-open back to OPEN.
 */
export type LocalSeoIssueStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "IGNORED";

const LOCAL_SEO_ISSUE_TRANSITIONS: Record<LocalSeoIssueStatus, LocalSeoIssueStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "IGNORED"],
  ACKNOWLEDGED: ["OPEN", "RESOLVED", "IGNORED"],
  RESOLVED: ["OPEN"],
  IGNORED: ["OPEN"],
};

export const LOCAL_SEO_ISSUE_TERMINAL_STATUSES: LocalSeoIssueStatus[] = ["RESOLVED", "IGNORED"];

export function canTransitionLocalSeoIssue(from: LocalSeoIssueStatus, to: LocalSeoIssueStatus): boolean {
  return LOCAL_SEO_ISSUE_TRANSITIONS[from].includes(to);
}
