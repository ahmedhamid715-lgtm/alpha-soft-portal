import { describe, it, expect } from "vitest";
import { canTransitionLocalSeoIssue, LOCAL_SEO_ISSUE_TERMINAL_STATUSES } from "@/lib/local-seo/issue-lifecycle";

describe("canTransitionLocalSeoIssue", () => {
  it("allows the full open workflow", () => {
    expect(canTransitionLocalSeoIssue("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionLocalSeoIssue("OPEN", "RESOLVED")).toBe(true);
    expect(canTransitionLocalSeoIssue("OPEN", "IGNORED")).toBe(true);
    expect(canTransitionLocalSeoIssue("ACKNOWLEDGED", "RESOLVED")).toBe(true);
    expect(canTransitionLocalSeoIssue("ACKNOWLEDGED", "IGNORED")).toBe(true);
    expect(canTransitionLocalSeoIssue("ACKNOWLEDGED", "OPEN")).toBe(true);
  });

  it("allows both RESOLVED and IGNORED to reopen", () => {
    expect(canTransitionLocalSeoIssue("RESOLVED", "OPEN")).toBe(true);
    expect(canTransitionLocalSeoIssue("IGNORED", "OPEN")).toBe(true);
  });

  it("rejects RESOLVED/IGNORED going anywhere except OPEN", () => {
    expect(canTransitionLocalSeoIssue("RESOLVED", "ACKNOWLEDGED")).toBe(false);
    expect(canTransitionLocalSeoIssue("RESOLVED", "IGNORED")).toBe(false);
    expect(canTransitionLocalSeoIssue("IGNORED", "RESOLVED")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    expect(canTransitionLocalSeoIssue("OPEN", "OPEN")).toBe(false);
  });

  it("marks RESOLVED and IGNORED as the terminal-ish statuses", () => {
    expect(LOCAL_SEO_ISSUE_TERMINAL_STATUSES).toEqual(["RESOLVED", "IGNORED"]);
  });
});
