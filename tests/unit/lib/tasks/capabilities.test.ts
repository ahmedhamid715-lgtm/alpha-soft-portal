import { describe, expect, it } from "vitest";
import { hrefFor, capabilitiesFor } from "@/lib/tasks/capabilities";

describe("hrefFor", () => {
  it("deep-links PROJECT_TASK to its own project's detail page, falling back to the list if context is missing", () => {
    expect(hrefFor("PROJECT_TASK", "task-1", "project-1", null)).toBe("/admin/projects/project-1");
    expect(hrefFor("PROJECT_TASK", "task-1", null, null)).toBe("/admin/projects");
  });

  it("links CRM_TASK to the CRM task list — no per-task detail page exists", () => {
    expect(hrefFor("CRM_TASK", "task-1", null, null)).toBe("/admin/crm/tasks");
  });

  it("deep-links both onboarding source types to the shared onboarding detail page, falling back to the list", () => {
    expect(hrefFor("ONBOARDING_CHECKLIST", "item-1", null, "onboarding-1")).toBe("/admin/crm/onboarding/onboarding-1");
    expect(hrefFor("ONBOARDING_REQUIREMENT", "item-1", null, "onboarding-1")).toBe("/admin/crm/onboarding/onboarding-1");
    expect(hrefFor("ONBOARDING_CHECKLIST", "item-1", null, null)).toBe("/admin/crm/onboarding");
  });

  it("links STANDALONE_TASK to its own native detail page by id — the one source with no other authoritative home", () => {
    expect(hrefFor("STANDALONE_TASK", "task-1", null, null)).toBe("/admin/tasks/task-1");
  });
});

describe("capabilitiesFor", () => {
  it("every capability is false when the caller lacks the source's own manage permission, regardless of status", () => {
    for (const sourceType of ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"] as const) {
      for (const status of ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"] as const) {
        const caps = capabilitiesFor(sourceType, status, false);
        expect(caps.canComplete).toBe(false);
        expect(caps.canAssign).toBe(false);
        expect(caps.canChangeDueDate).toBe(false);
        expect(caps.canReopen).toBe(false);
      }
    }
  });

  it("CRM_TASK never reopens, even with manage permission and a COMPLETED status", () => {
    expect(capabilitiesFor("CRM_TASK", "COMPLETED", true).canReopen).toBe(false);
    expect(capabilitiesFor("CRM_TASK", "OPEN", true).canComplete).toBe(true);
    expect(capabilitiesFor("CRM_TASK", "CANCELLED", true).canComplete).toBe(false);
  });

  it("onboarding items never assign or change due date through Task Management, even with manage permission", () => {
    for (const sourceType of ["ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT"] as const) {
      const caps = capabilitiesFor(sourceType, "OPEN", true);
      expect(caps.canAssign).toBe(false);
      expect(caps.canChangeDueDate).toBe(false);
    }
  });

  it("ONBOARDING_REQUIREMENT never reopens even when COMPLETED; ONBOARDING_CHECKLIST does", () => {
    expect(capabilitiesFor("ONBOARDING_REQUIREMENT", "COMPLETED", true).canReopen).toBe(false);
    expect(capabilitiesFor("ONBOARDING_CHECKLIST", "COMPLETED", true).canReopen).toBe(true);
  });

  it("PROJECT_TASK and STANDALONE_TASK support the full capability set (complete/reopen/assign/change due date) once terminal-state rules are satisfied", () => {
    for (const sourceType of ["PROJECT_TASK", "STANDALONE_TASK"] as const) {
      const open = capabilitiesFor(sourceType, "OPEN", true);
      expect(open).toEqual({ canComplete: true, canReopen: false, canAssign: true, canChangeDueDate: true });
      const completed = capabilitiesFor(sourceType, "COMPLETED", true);
      expect(completed).toEqual({ canComplete: false, canReopen: true, canAssign: true, canChangeDueDate: true });
    }
  });

  it("a CANCELLED task can never be completed or reopened, on any source, regardless of permission", () => {
    for (const sourceType of ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"] as const) {
      const caps = capabilitiesFor(sourceType, "CANCELLED", true);
      expect(caps.canComplete).toBe(false);
      expect(caps.canReopen).toBe(false);
    }
  });
});
