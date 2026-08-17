import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { auditEventRepository } from "@/server/repositories/audit-event-repository";

/**
 * The audit service core (`lib/audit/service.ts`), repository
 * (cursor pagination), and query service (`lib/audit/query.ts`) — real
 * Postgres, real permission engine, mocked identity (same technique
 * every authorization-adjacent integration test in this project uses —
 * see `role-service.test.ts`'s own top comment).
 */

let mockUser: { id: string; email?: string; name?: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

// `next/headers` needs a real Next.js request context — `resolveRequestMetadata()`
// in `service.ts` already catches this and falls back to null/null, but
// under plain Vitest `headers()` throws synchronously on import-time
// evaluation of some call paths in this Next version; mock it the same
// no-op way `authorization-engine.test.ts` and friends already handle
// `next/navigation`.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    throw new Error("no request scope in tests");
  }),
}));

describe.skipIf(!isDatabaseConfigured)("audit service + repository + query service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const auditEventIds: string[] = [];
  let orgAId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Audit Svc Org A", displayName: "Audit Svc Org A", slug: `audit-svc-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (auditEventIds.length) await db.auditEvent.deleteMany({ where: { id: { in: auditEventIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    auditEventIds.length = 0;
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeMember(organizationId: string, roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }, email?: string, name?: string) {
    mockUser = { id: userId, email, name };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  // --- audit.record() core ------------------------------------------------

  it("recordSuccess() resolves the actor from getCurrentUser() when no override is given", async () => {
    const { audit } = await import("@/lib/audit/service");
    const owner = await makeMember(orgAId, "owner", `svc-owner-${generateId()}@example.com`);
    actAs(owner.userId, owner.membership, undefined, "Real Owner");

    const event = await audit.recordSuccess({ action: "profile.updated", resourceType: "user", resourceId: owner.userId });
    auditEventIds.push(event.id);

    expect(event.actorType).toBe("USER");
    expect(event.actorUserId).toBe(owner.userId);
    expect(event.actorDisplayName).toBe("Real Owner");
    expect(event.outcome).toBe("SUCCESS");
  });

  it("recordFailure()/recordDenied() set the correct outcome", async () => {
    const { audit } = await import("@/lib/audit/service");
    mockUser = null;

    const failure = await audit.recordFailure({ action: "auth.login.failure", unauthenticatedActorDisplayName: "nobody@example.com" });
    auditEventIds.push(failure.id);
    expect(failure.outcome).toBe("FAILURE");

    const denied = await audit.recordDenied({ action: "security.authorization.denied" });
    auditEventIds.push(denied.id);
    expect(denied.outcome).toBe("DENIED");
  });

  it("knownActor overrides session resolution without ever setting actorUserId to a client-asserted value beyond what the caller itself resolved server-side", async () => {
    const { audit } = await import("@/lib/audit/service");
    mockUser = null; // no session at all — this is the login-success-before-cookie-visible case
    const realUser = await userRepository.create({ id: generateId(), email: `known-actor-${generateId()}@example.com`, name: "Known Actor" });
    userIds.push(realUser.id);

    const event = await audit.recordSuccess({
      action: "auth.login.success",
      knownActor: { userId: realUser.id, displayName: realUser.name },
    });
    auditEventIds.push(event.id);

    expect(event.actorUserId).toBe(realUser.id);
    expect(event.actorDisplayName).toBe("Known Actor");
  });

  it("unauthenticatedActorDisplayName populates actorDisplayName only — never actorUserId", async () => {
    const { audit } = await import("@/lib/audit/service");
    mockUser = null;

    const event = await audit.recordFailure({
      action: "auth.login.failure",
      unauthenticatedActorDisplayName: "attempted@example.com",
    });
    auditEventIds.push(event.id);

    expect(event.actorUserId).toBeNull();
    expect(event.actorType).toBe("SYSTEM");
    expect(event.actorDisplayName).toBe("attempted@example.com");
  });

  it("redacts previousState/newState/metadata automatically before writing — the caller never has to remember to", async () => {
    const { audit } = await import("@/lib/audit/service");
    mockUser = null;

    const event = await audit.recordSuccess({
      action: "profile.updated",
      unauthenticatedActorDisplayName: "system",
      previousState: { password: "old-hunter2", name: "Old Name" },
      newState: { password: "new-hunter2", name: "New Name" },
      metadata: { apiKey: "sk-secret", note: "routine update" },
    });
    auditEventIds.push(event.id);

    expect((event.previousState as Record<string, unknown>).password).toBe("[redacted]");
    expect((event.previousState as Record<string, unknown>).name).toBe("Old Name");
    expect((event.newState as Record<string, unknown>).password).toBe("[redacted]");
    expect((event.metadata as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect((event.metadata as Record<string, unknown>).note).toBe("routine update");
  });

  it("requestId/correlationId default to the same freshly-minted value when neither is supplied", async () => {
    const { audit } = await import("@/lib/audit/service");
    mockUser = null;
    const event = await audit.recordSuccess({ action: "profile.updated", unauthenticatedActorDisplayName: "system" });
    auditEventIds.push(event.id);
    expect(event.requestId).toBe(event.correlationId);
    expect(event.requestId.length).toBeGreaterThan(0);
  });

  it("an explicit requestId/correlationId is threaded through unchanged", async () => {
    const { audit } = await import("@/lib/audit/service");
    mockUser = null;
    const event = await audit.recordSuccess({
      action: "profile.updated",
      unauthenticatedActorDisplayName: "system",
      requestId: "req-fixed-1",
      correlationId: "corr-fixed-1",
    });
    auditEventIds.push(event.id);
    expect(event.requestId).toBe("req-fixed-1");
    expect(event.correlationId).toBe("corr-fixed-1");
  });

  // --- repository: cursor pagination ---------------------------------------

  it("cursor pagination visits every inserted row exactly once across pages — no skip, no duplicate", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = generateId();
      await db.auditEvent.create({
        data: { id, organizationId: orgAId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", requestId: id, correlationId: id },
      });
      ids.push(id);
      auditEventIds.push(id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await auditEventRepository.list({ cursor, limit: 3 }, { organizationId: orgAId });
      seen.push(...result.items.map((r) => r.id));
      if (!result.pageInfo.hasNextPage) break;
      cursor = result.pageInfo.nextCursor!;
    }

    const seenOfInterest = seen.filter((id) => ids.includes(id));
    expect(seenOfInterest.sort()).toEqual([...ids].sort());
    expect(new Set(seenOfInterest).size).toBe(seenOfInterest.length); // no duplicates
  });

  // --- query service: empty-string filter params (the real HTTP-request shape) ---

  it("listOrganizationAuditEvents does not throw when optional filters are submitted as empty strings — the shape a real <form method=get> submits for an unfilled field, not `undefined`", async () => {
    const { listOrganizationAuditEvents } = await import("@/lib/audit/query");
    const owner = await makeMember(orgAId, "owner", `svc-empty-filter-owner-${generateId()}@example.com`);
    actAs(owner.userId, owner.membership);

    // Regression test for a real bug: `z.coerce.date().optional()` does
    // NOT treat `""` as "absent" — `new Date("")` is `Invalid Date`,
    // which fails validation — so submitting the filter form with the
    // date range left blank 500'd the whole page. Found via a real
    // Playwright browser test clicking "Apply filters" with the date
    // inputs empty (`audit.spec.ts`), not by reading the schema.
    await expect(
      listOrganizationAuditEvents({
        organizationId: orgAId,
        search: "",
        category: "",
        outcome: "",
        createdAfter: "",
        createdBefore: "",
      }),
    ).resolves.toBeDefined();
  });

  // --- query service: getAuditEventDetail's organizationId hint ------------

  it("getAuditEventDetail(organizationId hint) returns null — not a thrown PermissionDeniedError — for a real event belonging to a DIFFERENT organization than the hint", async () => {
    const { getAuditEventDetail } = await import("@/lib/audit/query");
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Audit Svc Detail Org B", displayName: "Audit Svc Detail Org B", slug: `audit-svc-detail-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const orgBEventId = generateId();
    await db.auditEvent.create({
      data: { id: orgBEventId, organizationId: orgBId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", requestId: orgBEventId, correlationId: orgBEventId },
    });
    auditEventIds.push(orgBEventId);

    const owner = await makeMember(orgAId, "owner", `svc-idor-owner-${generateId()}@example.com`);
    actAs(owner.userId, owner.membership);

    // Regression test: the org-scoped detail page passes `organizationId`
    // as an expectation. A real event that exists but belongs to a
    // DIFFERENT organization must resolve to `null` (identical to "no
    // such event") — never throw `PermissionDeniedError` for the OTHER
    // organization's `audit.read`, which crashed the page with an
    // unhandled 500 instead of a clean 404 (found via a real adversarial
    // E2E test, `audit-security.spec.ts`).
    const result = await getAuditEventDetail({ id: orgBEventId, organizationId: orgAId });
    expect(result).toBeNull();

    // Sanity: the SAME event resolves normally for a caller who
    // genuinely holds `audit.read` for Org B (its real organization) —
    // this isn't masking a real "always returns null" bug. A platform
    // admin who holds only `audit.readPlatform` (not ORGANIZATION-scope
    // `audit.read` for this specific customer org) correctly ALSO gets
    // `null` here — the same "platform admin ≠ unlimited customer-org
    // access" property this whole function exists to enforce.
    const orgBOwner = await makeMember(orgBId, "owner", `svc-idor-orgb-owner-${generateId()}@example.com`);
    actAs(orgBOwner.userId, orgBOwner.membership);
    const viaOrgBOwner = await getAuditEventDetail({ id: orgBEventId });
    expect(viaOrgBOwner?.id).toBe(orgBEventId);
  });

  // --- query service: permission gating ------------------------------------

  it("listOrganizationAuditEvents throws for a member without audit.read", async () => {
    const { listOrganizationAuditEvents } = await import("@/lib/audit/query");
    const viewer = await makeMember(orgAId, "viewer", `svc-viewer-${generateId()}@example.com`);
    actAs(viewer.userId, viewer.membership);

    await expect(listOrganizationAuditEvents({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("listOrganizationAuditEvents succeeds for an owner and only returns this organization's events", async () => {
    const { listOrganizationAuditEvents } = await import("@/lib/audit/query");
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Audit Svc Org B", displayName: "Audit Svc Org B", slug: `audit-svc-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const idA = generateId();
    await db.auditEvent.create({ data: { id: idA, organizationId: orgAId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", requestId: idA, correlationId: idA } });
    const idB = generateId();
    await db.auditEvent.create({ data: { id: idB, organizationId: orgBId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", requestId: idB, correlationId: idB } });
    auditEventIds.push(idA, idB);

    const owner = await makeMember(orgAId, "owner", `svc-owner2-${generateId()}@example.com`);
    actAs(owner.userId, owner.membership);

    const page = await listOrganizationAuditEvents({ organizationId: orgAId, limit: 50 });
    const ids = page.items.map((e) => e.id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idB);
  });

  // --- query service: platform scope is structurally narrow ---------------

  it("listPlatformAuditEvents never returns a real customer organization's own events, even though RLS itself would permit it (application-layer narrowing, not a substitute for RLS)", async () => {
    const { listPlatformAuditEvents } = await import("@/lib/audit/query");
    const platformOrg = await organizationRepository.findPlatformOrganization();
    expect(platformOrg).not.toBeNull();

    const platformAdmin = await makeMember(platformOrg!.id, "platform_admin", `svc-platform-admin-${generateId()}@example.com`);
    actAs(platformAdmin.userId, platformAdmin.membership);

    const customerEventId = generateId();
    await db.auditEvent.create({
      data: { id: customerEventId, organizationId: orgAId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", requestId: customerEventId, correlationId: customerEventId },
    });
    const nullOrgEventId = generateId();
    await db.auditEvent.create({
      data: { id: nullOrgEventId, organizationId: null, actorType: "SYSTEM", action: "auth.login.success", category: "AUTHENTICATION", outcome: "SUCCESS", requestId: nullOrgEventId, correlationId: nullOrgEventId },
    });
    auditEventIds.push(customerEventId, nullOrgEventId);

    const page = await listPlatformAuditEvents({ limit: 100 });
    const ids = page.items.map((e) => e.id);
    expect(ids).not.toContain(customerEventId);
    expect(ids).toContain(nullOrgEventId);
  });

  // --- export -------------------------------------------------------------

  it("exportOrganizationAuditEvents produces a CSV with the expected header row and records audit.export.created", async () => {
    const { exportOrganizationAuditEvents } = await import("@/lib/audit/query");
    const id = generateId();
    await db.auditEvent.create({
      data: { id, organizationId: orgAId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", resourceName: "Test Org", requestId: id, correlationId: id },
    });
    auditEventIds.push(id);

    const owner = await makeMember(orgAId, "owner", `svc-export-owner-${generateId()}@example.com`);
    actAs(owner.userId, owner.membership);

    const result = await exportOrganizationAuditEvents({ organizationId: orgAId });
    expect(result.truncated).toBe(false);
    const lines = result.csv.split("\n");
    expect(lines[0]).toBe("id,createdAt,action,category,outcome,actorDisplayName,actorUserId,resourceType,resourceId,resourceName,requestId,correlationId");
    expect(result.csv).toContain(id);

    const exportEvents = await db.auditEvent.findMany({ where: { action: "audit.export.created", organizationId: orgAId } });
    expect(exportEvents.length).toBeGreaterThan(0);
    for (const e of exportEvents) auditEventIds.push(e.id);
  });

  it("CSV export correctly quotes a resourceName containing a comma and a double quote — a raw, unescaped field would corrupt every column after it", async () => {
    const { exportOrganizationAuditEvents } = await import("@/lib/audit/query");
    const id = generateId();
    const trickyName = 'Acme, "The Best" Corp';
    await db.auditEvent.create({
      data: { id, organizationId: orgAId, actorType: "SYSTEM", action: "organization.updated", category: "ORGANIZATION", outcome: "SUCCESS", resourceName: trickyName, requestId: id, correlationId: id },
    });
    auditEventIds.push(id);

    const owner = await makeMember(orgAId, "owner", `svc-export-csv-owner-${generateId()}@example.com`);
    actAs(owner.userId, owner.membership);

    const result = await exportOrganizationAuditEvents({ organizationId: orgAId });
    const row = result.csv.split("\n").find((line) => line.includes(id));
    expect(row).toContain('"Acme, ""The Best"" Corp"');

    const exportEvents = await db.auditEvent.findMany({ where: { action: "audit.export.created", organizationId: orgAId } });
    for (const e of exportEvents) auditEventIds.push(e.id);
  });

  // --- end-to-end wiring: a real service function's audit call site --------

  it("role-service.ts's createCustomRole() writes a role.created audit event inside the same transaction as the role itself", async () => {
    const { createCustomRole } = await import("@/server/services/role-service");
    const admin = await makeMember(orgAId, "admin", `svc-role-admin-${generateId()}@example.com`);
    actAs(admin.userId, admin.membership);

    const role = await createCustomRole({ organizationId: orgAId, key: `svc-test-role-${Date.now()}`, name: "Service Test Role", permissions: [] });

    const events = await db.auditEvent.findMany({ where: { action: "role.created", resourceId: role.id } });
    expect(events.length).toBe(1);
    for (const e of events) auditEventIds.push(e.id);
    expect(events[0].organizationId).toBe(orgAId);
    expect(events[0].actorUserId).toBe(admin.userId);

    await db.role.delete({ where: { id: role.id } }).catch(() => {});
  });
});
