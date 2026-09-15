import { describe, it, expect } from "vitest";
import { canTransitionWebsitePage, WEBSITE_PAGE_READY_STATUSES } from "@/lib/website-dev/page-lifecycle";

describe("canTransitionWebsitePage", () => {
  it("allows the full forward workflow", () => {
    expect(canTransitionWebsitePage("PLANNED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionWebsitePage("IN_PROGRESS", "QA")).toBe(true);
    expect(canTransitionWebsitePage("QA", "READY_FOR_LAUNCH")).toBe(true);
    expect(canTransitionWebsitePage("READY_FOR_LAUNCH", "LIVE")).toBe(true);
  });

  it("allows QA to send a page back for rework", () => {
    expect(canTransitionWebsitePage("QA", "IN_PROGRESS")).toBe(true);
  });

  it("allows a live or ready page to be pulled back into revision", () => {
    expect(canTransitionWebsitePage("READY_FOR_LAUNCH", "IN_PROGRESS")).toBe(true);
    expect(canTransitionWebsitePage("LIVE", "IN_PROGRESS")).toBe(true);
  });

  it("allows archiving from any active state, and restoring from archived", () => {
    expect(canTransitionWebsitePage("PLANNED", "ARCHIVED")).toBe(true);
    expect(canTransitionWebsitePage("LIVE", "ARCHIVED")).toBe(true);
    expect(canTransitionWebsitePage("ARCHIVED", "IN_PROGRESS")).toBe(true);
  });

  it("rejects skipping QA entirely", () => {
    expect(canTransitionWebsitePage("PLANNED", "READY_FOR_LAUNCH")).toBe(false);
    expect(canTransitionWebsitePage("IN_PROGRESS", "LIVE")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    expect(canTransitionWebsitePage("QA", "QA")).toBe(false);
  });

  it("marks READY_FOR_LAUNCH and LIVE as the ready-for-launch-readiness statuses", () => {
    expect(WEBSITE_PAGE_READY_STATUSES).toEqual(["READY_FOR_LAUNCH", "LIVE"]);
  });
});
