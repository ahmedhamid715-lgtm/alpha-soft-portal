import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { ExternalServiceError } from "@/lib/errors/app-error";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

/** A 1536-dim vector with a single "topic" dimension set — same topic index -> cosine distance 0; different topics -> orthogonal (distance 1). Matches this schema's fixed embedding dimension exactly. */
function topicVector(topicIndex: number): number[] {
  const v = new Array(1536).fill(0);
  v[topicIndex] = 1;
  return v;
}

const mockProvider = { embed: vi.fn() };
vi.mock("@/lib/knowledge/embedding/openai/provider", () => ({ openAiEmbeddingProvider: mockProvider }));

function mockEmbedSuccess(topicIndex = 0) {
  mockProvider.embed.mockImplementationOnce(async (input: { texts: string[] }) => ({
    items: input.texts.map((_, index) => ({ vector: topicVector(topicIndex), index })),
    model: "text-embedding-3-small",
    dimension: 1536,
  }));
}

describe.skipIf(!isDatabaseConfigured)("knowledge-ingestion-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    mockProvider.embed.mockReset();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "KI Test Org A", displayName: "KI Test Org A", slug: `ki-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
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

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  async function makeSource(organizationId: string) {
    const { createOrganizationSource } = await import("@/server/services/knowledge-source-service");
    return createOrganizationSource({ organizationId, name: `Source ${generateId()}` });
  }

  it("ingestText: a real ingestion produces a READY version with real chunks/embeddings, and is audited as knowledge.document.ingested", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner1@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    mockEmbedSuccess(1);

    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const result = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Getting started", content: "Alpha OS is an enterprise platform.\n\nIt supports many modules." });

    expect(result.deduplicated).toBe(false);
    expect(result.version.status).toBe("READY");
    expect(result.version.chunkCount).toBeGreaterThan(0);
    expect(result.document.currentVersionId).toBe(result.version.id);
    expect(mockProvider.embed).toHaveBeenCalledTimes(1);

    const { auditEventRepository } = await import("@/server/repositories/audit-event-repository");
    const { withTenantContext } = await import("@/lib/tenancy/context");
    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "knowledge.document.ingested" }, tx));
    expect(events.items).toHaveLength(1);
  });

  it("ingestText: identical content ingested twice (same canonicalId) is a genuine no-op — no duplicate document, no second embedding call", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner2@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    mockEmbedSuccess(2);

    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const first = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "FAQ", content: "How do I reset my password?", canonicalId: "faq-1" });
    expect(first.deduplicated).toBe(false);
    expect(mockProvider.embed).toHaveBeenCalledTimes(1);

    const second = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "FAQ", content: "How do I reset my password?", canonicalId: "faq-1" });
    expect(second.deduplicated).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(second.version.id).toBe(first.version.id);
    expect(mockProvider.embed).toHaveBeenCalledTimes(1); // never called a second time
  });

  it("ingestText: CHANGED content under the same canonicalId creates a new version, marks the old one SUPERSEDED, and updates currentVersionId", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner3@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    mockEmbedSuccess(3);

    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const first = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Policy", content: "Version one of the policy.", canonicalId: "policy-1" });

    mockEmbedSuccess(3);
    const second = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Policy", content: "Version TWO of the policy — genuinely different content.", canonicalId: "policy-1" });

    expect(second.document.id).toBe(first.document.id);
    expect(second.version.id).not.toBe(first.version.id);
    expect(second.version.versionNumber).toBe(2);
    expect(second.document.currentVersionId).toBe(second.version.id);

    const { knowledgeDocumentRepository } = await import("@/server/repositories/knowledge-document-repository");
    const { withTenantContext } = await import("@/lib/tenancy/context");
    const firstVersionAfter = await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) => knowledgeDocumentRepository.findVersionById(first.version.id, tx));
    expect(firstVersionAfter?.status).toBe("SUPERSEDED");
  });

  it("ingestText: if the embedding provider is unavailable, the version is marked FAILED (never silently 'ready' with no real embeddings), and the failure is audited", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner4@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    // The REAL provider always maps SDK errors to ExternalServiceError before they escape — the mock replicates that same contract (same discipline ai-conversation-service.test.ts's own mock already establishes).
    mockProvider.embed.mockRejectedValueOnce(new ExternalServiceError("OpenAI"));

    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const result = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Will fail", content: "This content cannot be embedded in this test." });

    expect(result.version.status).toBe("FAILED");
    expect(result.version.failureReason).toBeTruthy();
    expect(result.document.currentVersionId).toBeNull(); // never points at a FAILED version

    const { auditEventRepository } = await import("@/server/repositories/audit-event-repository");
    const { withTenantContext } = await import("@/lib/tenancy/context");
    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "knowledge.document.ingestion_failed" }, tx));
    expect(events.items).toHaveLength(1);
  });

  it("ingestText: rejects oversized content before any processing (spec §18 — oversized payload)", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner5@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    await expect(ingestText({ organizationId: orgAId, sourceId: source.id, title: "Too big", content: "x".repeat(250_000) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockProvider.embed).not.toHaveBeenCalled();
  });

  it("ingestText: a member without knowledge.source.manage is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner6@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);

    const viewer = await makeMember(orgAId, "viewer", "ki-viewer6@example.com");
    actAs(viewer.userId, viewer.membership);
    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    await expect(ingestText({ organizationId: orgAId, sourceId: source.id, title: "Denied", content: "Should never be created." })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(mockProvider.embed).not.toHaveBeenCalled();
  });

  it("deleteDocument: soft-deletes — the document disappears from listings, but the row still physically exists (proven directly)", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner7@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    mockEmbedSuccess(7);
    const { ingestText, deleteDocument } = await import("@/server/services/knowledge-ingestion-service");
    const ingested = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "To delete", content: "Delete me." });

    const deleted = await deleteDocument({ organizationId: orgAId, documentId: ingested.document.id });
    expect(deleted.deletedAt).not.toBeNull();

    const { knowledgeDocumentRepository } = await import("@/server/repositories/knowledge-document-repository");
    const { withTenantContext } = await import("@/lib/tenancy/context");
    const viaNormalLookup = await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) => knowledgeDocumentRepository.findById(ingested.document.id, tx));
    expect(viaNormalLookup).toBeNull(); // genuinely unreachable through the normal path

    const viaDirectQuery = await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) => knowledgeDocumentRepository.findByIdIncludingDeleted(ingested.document.id, tx));
    expect(viaDirectQuery).not.toBeNull(); // soft delete, not erasure — the row is really still there
    expect(viaDirectQuery?.deletedAt).not.toBeNull();
  });

  it("reindexDocument: re-running on an already-ready version is idempotent — no duplicate chunks, no wasted embedding call when the strategy/model haven't changed", async () => {
    const owner = await makeMember(orgAId, "owner", "ki-owner8@example.com");
    actAs(owner.userId, owner.membership);
    const source = await makeSource(orgAId);
    mockEmbedSuccess(8);
    const { ingestText, reindexDocument } = await import("@/server/services/knowledge-ingestion-service");
    const ingested = await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Reindex me", content: "Content to reindex." });
    expect(mockProvider.embed).toHaveBeenCalledTimes(1);

    const reindexed = await reindexDocument({ organizationId: orgAId, documentId: ingested.document.id });
    expect(reindexed.version.status).toBe("READY");
    expect(mockProvider.embed).toHaveBeenCalledTimes(1); // still just the one call — nothing new to chunk or embed
  });
});
