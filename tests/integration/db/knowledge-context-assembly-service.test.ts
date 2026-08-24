import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { RETRIEVED_CONTENT_TAG } from "@/lib/knowledge/trust-boundary";

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

describe.skipIf(!isDatabaseConfigured)("knowledge-context-assembly-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    mockProvider.embed.mockReset();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "KCA Test Org A", displayName: "KCA Test Org A", slug: `kca-org-a-${orgAId}` });
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

  it("assembles trust-labeled, provenance-carrying context blocks within budget", async () => {
    const owner = await makeMember(orgAId, "owner", "kca-owner1@example.com");
    actAs(owner.userId, owner.membership);
    const { createOrganizationSource } = await import("@/server/services/knowledge-source-service");
    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const source = await createOrganizationSource({ organizationId: orgAId, name: "KCA source" });
    mockProvider.embed.mockImplementationOnce(async (input: { texts: string[] }) => ({ items: input.texts.map((_, index) => ({ vector: topicVector(20), index })), model: "text-embedding-3-small", dimension: 1536 }));
    await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Context source", content: "This is the exact content that should show up as assembled context." });

    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(20), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { assembleContext } = await import("@/server/services/knowledge-context-assembly-service");
    const result = await assembleContext({ organizationId: orgAId, query: "assembled context" });

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks[0]).toContain(`<${RETRIEVED_CONTENT_TAG}`);
    expect(result.blocks[0]).toContain("exact content");
    expect(result.citations.length).toBe(result.blocks.length);
    expect(result.citations[0]).toMatchObject({ documentId: expect.any(String), sourceId: source.id });
    expect(result.usedChars).toBeLessThanOrEqual(result.budgetChars);
  });

  it("enforces the caller's own budgetChars — never exceeds it", async () => {
    const owner = await makeMember(orgAId, "owner", "kca-owner2@example.com");
    actAs(owner.userId, owner.membership);
    const { createOrganizationSource } = await import("@/server/services/knowledge-source-service");
    const { ingestText } = await import("@/server/services/knowledge-ingestion-service");
    const source = await createOrganizationSource({ organizationId: orgAId, name: "KCA budget source" });
    const longContent = "A genuinely long paragraph of real content. ".repeat(100);
    mockProvider.embed.mockImplementationOnce(async (input: { texts: string[] }) => ({ items: input.texts.map((_, index) => ({ vector: topicVector(21), index })), model: "text-embedding-3-small", dimension: 1536 }));
    await ingestText({ organizationId: orgAId, sourceId: source.id, title: "Long doc", content: longContent });

    mockProvider.embed.mockImplementationOnce(async () => ({ items: [{ vector: topicVector(21), index: 0 }], model: "text-embedding-3-small", dimension: 1536 }));
    const { assembleContext } = await import("@/server/services/knowledge-context-assembly-service");
    const result = await assembleContext({ organizationId: orgAId, query: "genuinely long paragraph", budgetChars: 500 });

    expect(result.budgetChars).toBe(500);
    expect(result.usedChars).toBeLessThanOrEqual(500);
  });

  it("requires knowledge.retrieve — enforced by delegating to retrieveKnowledge(), no separate/weaker authorization path", async () => {
    const viewer = await makeMember(orgAId, "viewer", "kca-viewer3@example.com");
    actAs(viewer.userId, viewer.membership);
    const { assembleContext } = await import("@/server/services/knowledge-context-assembly-service");
    await expect(assembleContext({ organizationId: orgAId, query: "anything" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
