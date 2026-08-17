import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/generated/prisma/client";
import { describeAuditEvent } from "@/lib/audit/describe";

/** Minimal, fully-specified fixture — every field `describeAuditEvent()` might read has an explicit (if often null) value, so a test overriding one field can't accidentally rely on an `undefined` a real Prisma row would never have. */
function fixture(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: "01a00000-0000-7000-8000-000000000000",
    organizationId: null,
    actorType: "USER",
    actorUserId: null,
    actorServiceId: null,
    actorDisplayName: null,
    action: "organization.created",
    category: "ORGANIZATION",
    outcome: "SUCCESS",
    resourceType: null,
    resourceId: null,
    resourceName: null,
    previousState: null,
    newState: null,
    metadata: null,
    ipAddress: null,
    userAgent: null,
    requestId: "req-1",
    correlationId: "req-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as AuditEvent;
}

describe("describeAuditEvent", () => {
  it("describes a role change with before/after role names", () => {
    const line = describeAuditEvent(
      fixture({
        action: "organization.member.role_changed",
        actorDisplayName: "Austin",
        resourceName: "Ahmed",
        previousState: { role: "member" },
        newState: { role: "admin" },
      }),
    );
    expect(line).toBe("Austin changed Ahmed's role from member to admin.");
  });

  it("falls back to a generic role-change line when previousState/newState are missing", () => {
    const line = describeAuditEvent(fixture({ action: "organization.member.role_changed", actorDisplayName: "Austin", resourceName: "Ahmed" }));
    expect(line).toBe("Austin changed Ahmed's role.");
  });

  it("describes an ownership transfer", () => {
    const line = describeAuditEvent(fixture({ action: "organization.owner.transfer_completed", actorDisplayName: "Austin", resourceName: "Ahmed" }));
    expect(line).toBe("Austin transferred ownership of the organization to Ahmed.");
  });

  it("describes a login success", () => {
    const line = describeAuditEvent(fixture({ action: "auth.login.success", actorDisplayName: "Austin" }));
    expect(line).toBe("Austin signed in.");
  });

  it("describes a login failure against a known email, without asserting a real identity", () => {
    const line = describeAuditEvent(fixture({ action: "auth.login.failure", actorDisplayName: "nobody@example.com", actorType: "SYSTEM" }));
    expect(line).toBe("A sign-in attempt failed for nobody@example.com.");
  });

  it("falls back to 'Someone'/'a resource' when actor/resource display names are both null", () => {
    const line = describeAuditEvent(fixture({ action: "organization.created", actorType: "USER", actorDisplayName: null, resourceName: null }));
    expect(line).toBe("Someone created a resource.");
  });

  it("uses 'The system' for a SYSTEM actor with no display name", () => {
    const line = describeAuditEvent(fixture({ action: "organization.created", actorType: "SYSTEM", actorDisplayName: null, resourceName: "Acme" }));
    expect(line).toBe("The system created Acme.");
  });

  it("falls back to the catalog's own description for an action with no specific template", () => {
    const line = describeAuditEvent(fixture({ action: "role.created", actorDisplayName: "Austin", resourceName: "Support Lead" }));
    expect(line).toBe("A custom organization role was created.");
  });

  it("degrades gracefully for an action no longer in the catalog (append-only table, catalog can outlive an old action)", () => {
    const line = describeAuditEvent(fixture({ action: "legacy.removed_action", actorDisplayName: "Austin" }));
    expect(line).toBe("Austin performed legacy.removed_action.");
  });
});
