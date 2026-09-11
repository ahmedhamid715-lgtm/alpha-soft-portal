import { describe, it, expect } from "vitest";
import { canTransitionSeoIssue, SEO_ISSUE_TERMINAL_STATUSES } from "@/lib/seo/issue-lifecycle";

describe("canTransitionSeoIssue", () => {
  it("allows the full open workflow", () => {
    expect(canTransitionSeoIssue("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionSeoIssue("OPEN", "RESOLVED")).toBe(true);
    expect(canTransitionSeoIssue("OPEN", "IGNORED")).toBe(true);
    expect(canTransitionSeoIssue("ACKNOWLEDGED", "RESOLVED")).toBe(true);
    expect(canTransitionSeoIssue("ACKNOWLEDGED", "IGNORED")).toBe(true);
    expect(canTransitionSeoIssue("ACKNOWLEDGED", "OPEN")).toBe(true);
  });

  it("allows both RESOLVED and IGNORED to reopen — neither is truly terminal", () => {
    expect(canTransitionSeoIssue("RESOLVED", "OPEN")).toBe(true);
    expect(canTransitionSeoIssue("IGNORED", "OPEN")).toBe(true);
  });

  it("rejects RESOLVED/IGNORED going anywhere except OPEN", () => {
    expect(canTransitionSeoIssue("RESOLVED", "ACKNOWLEDGED")).toBe(false);
    expect(canTransitionSeoIssue("RESOLVED", "IGNORED")).toBe(false);
    expect(canTransitionSeoIssue("IGNORED", "RESOLVED")).toBe(false);
    expect(canTransitionSeoIssue("IGNORED", "ACKNOWLEDGED")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    expect(canTransitionSeoIssue("OPEN", "OPEN")).toBe(false);
  });

  it("marks RESOLVED and IGNORED as the terminal-ish statuses", () => {
    expect(SEO_ISSUE_TERMINAL_STATUSES).toEqual(["RESOLVED", "IGNORED"]);
  });
});
