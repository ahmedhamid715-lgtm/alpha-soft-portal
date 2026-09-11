/**
 * `SeoIssue` lifecycle state machine (Build 30 — Roadmap Module 24).
 * Mirrors `src/lib/services/lifecycle.ts`'s own exact shape/reasoning.
 *
 * Unlike `CustomerServiceStatus`, NEITHER RESOLVED nor IGNORED is truly
 * terminal — a real-world technical issue can recur after being fixed
 * (a broken link comes back, a regression reintroduces a missing meta
 * description), and staff can always decide an ignored issue deserves
 * attention after all. Both re-open back to OPEN, which is the one
 * state every other state can reach.
 */
export type SeoIssueStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "IGNORED";

const SEO_ISSUE_TRANSITIONS: Record<SeoIssueStatus, SeoIssueStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "IGNORED"],
  ACKNOWLEDGED: ["OPEN", "RESOLVED", "IGNORED"],
  RESOLVED: ["OPEN"],
  IGNORED: ["OPEN"],
};

/** "No further action expected without an explicit reopen" — same convention `CUSTOMER_SERVICE_TERMINAL_STATUSES` establishes even though both states have one outgoing edge (reopen). */
export const SEO_ISSUE_TERMINAL_STATUSES: SeoIssueStatus[] = ["RESOLVED", "IGNORED"];

export function canTransitionSeoIssue(from: SeoIssueStatus, to: SeoIssueStatus): boolean {
  return SEO_ISSUE_TRANSITIONS[from].includes(to);
}
