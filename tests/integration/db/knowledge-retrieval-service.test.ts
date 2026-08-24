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

describe.skipIf(!isDatabaseConfigured)("knowledge-retrieval-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    mockProvider.embed.mockReset();

    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "KR Test Org A", displayName: "KR Test Org A", slug: `kr-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "KR Test Org B", displayName: "KR Test Org B", slug: `kr-org-b-${orgBId}` });
    orgIds.push(orgAId, orgBId);

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

  async function makeSourceAndIngest(organizationId: string, opts: { classification?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED"; title: string; content: string; topicIndex: number }) {
    const { createOrganizationSource } = await import("@/server/services/knowledge-source-service");
    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const source = await createOrganizationSource({ organizationId, name: `Source for ${opts.title}`, classification: opts.classification ?? "INTERNAL" });
    mockEmbedSuccess(opts.topicIndex);
    const result = await ingestText({ organizationId, sourceId: source.id, title: opts.title, content: opts.content });
    return { source, ...result };
  }

  it("requires knowledge.retrieve — a viewer (only knowledge.source.read) is denied", async () => {
    const viewer = await makeMember(orgAId, "viewer", "kr-viewer@example.com");
    actAs(viewer.userId, viewer.membership);
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    await expect(retrieveKnowledge({ organizationId: orgAId, query: "anything" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("finds real content via keyword search alone when the embedding provider is unavailable — degrades, never fails outright", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner1@example.com");
    actAs(owner.userId, owner.membership);
    await makeSourceAndIngest(orgAId, { title: "Refund policy", content: "Our refund policy allows returns within thirty days of purchase.", topicIndex: 1 });

    mockProvider.embed.mockRejectedValueOnce(new ExternalServiceError("OpenAI"));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgAId, query: "refund policy" });

    expect(result.degraded).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.content).toContain("refund");
  });

  it("hybrid search: real semantic search finds a topically-related chunk that shares NO keywords with the query", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner2@example.com");
    actAs(owner.userId, owner.membership);
    // The document's real words never appear in the query below — only a shared "topic vector" (mocked embedding) connects them.
    await makeSourceAndIngest(orgAId, { title: "Onboarding", content: "New team members complete orientation during their first week of employment.", topicIndex: 5 });

    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(5), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgAId, query: "totally unrelated keyword string with zero overlap" });

    expect(result.degraded).toBe(false);
    expect(result.items.some((item) => item.content.includes("orientation"))).toBe(true);
  });

  it("cross-tenant: Org B's owner never sees Org A's content, even with an identical query", async () => {
    const ownerA = await makeMember(orgAId, "owner", "kr-owner-a3@example.com");
    actAs(ownerA.userId, ownerA.membership);
    await makeSourceAndIngest(orgAId, { title: "Org A secret process", content: "Org A's own internal process document, never for Org B.", topicIndex: 9 });

    const ownerB = await makeMember(orgBId, "owner", "kr-owner-b3@example.com");
    actAs(ownerB.userId, ownerB.membership);
    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(9), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgBId, query: "internal process" });

    expect(result.items.every((item) => !item.content.includes("Org A"))).toBe(true);
  });

  it("classification gating: a plain knowledge.retrieve holder (member) cannot retrieve from a CONFIDENTIAL source", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner4@example.com");
    actAs(owner.userId, owner.membership);
    await makeSourceAndIngest(orgAId, { title: "Executive compensation", classification: "CONFIDENTIAL", content: "Confidential executive compensation figures for this fiscal year.", topicIndex: 11 });

    const member = await makeMember(orgAId, "member", "kr-member4@example.com");
    actAs(member.userId, member.membership);
    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(11), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgAId, query: "executive compensation" });

    expect(result.items.every((item) => !item.content.includes("Confidential"))).toBe(true);
  });

  it("classification gating: an owner (holds knowledge.source.manage) CAN retrieve from a CONFIDENTIAL source", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner5@example.com");
    actAs(owner.userId, owner.membership);
    await makeSourceAndIngest(orgAId, { title: "Board minutes", classification: "RESTRICTED", content: "Restricted board meeting minutes for this quarter.", topicIndex: 13 });

    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(13), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgAId, query: "board meeting minutes" });

    expect(result.items.some((item) => item.content.includes("Restricted"))).toBe(true);
  });

  it("an ARCHIVED source's documents are never retrievable, regardless of classification", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner6@example.com");
    actAs(owner.userId, owner.membership);
    const ingested = await makeSourceAndIngest(orgAId, { title: "Deprecated policy", content: "This deprecated policy document should stop being retrievable once archived.", topicIndex: 15 });

    const { updateSourceStatus } = await import("@/server/services/knowledge-source-service");
    await updateSourceStatus({ organizationId: orgAId, sourceId: ingested.source.id, status: "ARCHIVED" });

    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(15), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgAId, query: "deprecated policy" });

    expect(result.items.every((item) => !item.content.includes("deprecated"))).toBe(true);
  });

  it("a DELETED document is never retrievable", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner7@example.com");
    actAs(owner.userId, owner.membership);
    const ingested = await makeSourceAndIngest(orgAId, { title: "To be deleted", content: "This uniquely-phrased deletable content must vanish from retrieval.", topicIndex: 17 });

    const { deleteDocument } = await import("@/server/services/knowledge-ingestion-service");
    await deleteDocument({ organizationId: orgAId, documentId: ingested.document.id });

    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(17), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    const result = await retrieveKnowledge({ organizationId: orgAId, query: "deletable content" });

    expect(result.items.every((item) => !item.content.includes("deletable"))).toBe(true);
  });

  it("rate limiting: exceeding the organization's own retrieval limit is denied without running a search, and audited", async () => {
    const owner = await makeMember(orgAId, "owner", "kr-owner8@example.com");
    actAs(owner.userId, owner.membership);
    mockProvider.embed.mockResolvedValue({ items: [{ vector: topicVector(0), index: 0 }], model: "text-embedding-3-small", dimension: 1536 });

    const { retrieveKnowledge } = await import("@/server/services/knowledge-retrieval-service");
    // The real limit is 60/hour per organization (see rate-limit.ts's own knowledgeRetrievalRateLimiter) — drive it to exhaustion.
    for (let i = 0; i < 60; i++) {
      await retrieveKnowledge({ organizationId: orgAId, query: `query ${i}` });
    }
    await expect(retrieveKnowledge({ organizationId: orgAId, query: "one too many" })).rejects.toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });

    const { auditEventRepository } = await import("@/server/repositories/audit-event-repository");
    const { withTenantContext } = await import("@/lib/tenancy/context");
    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "knowledge.rate_limit.exceeded" }, tx));
    expect(events.items.length).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
