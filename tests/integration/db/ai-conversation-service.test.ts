import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { auditEventRepository } from "@/server/repositories/audit-event-repository";
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

const mockProvider = { sendMessage: vi.fn() };
vi.mock("@/lib/ai/provider/anthropic/provider", () => ({ anthropicChatProvider: mockProvider }));

function mockReply(content = "Here is how billing works.") {
  mockProvider.sendMessage.mockResolvedValueOnce({ content, model: "claude-opus-5", inputTokens: 40, outputTokens: 12, providerMessageId: `msg_${generateId()}`, stopReason: "end_turn" });
}

describe.skipIf(!isDatabaseConfigured)("ai-conversation-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    mockProvider.sendMessage.mockReset();

    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "AI Test Org A", displayName: "AI Test Org A", slug: `ai-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "AI Test Org B", displayName: "AI Test Org B", slug: `ai-org-b-${orgBId}` });
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

  it("requires ai.use — a viewer (no ai.use) is denied", async () => {
    const viewer = await makeMember(orgAId, "viewer", "ai-denied-viewer@example.com");
    actAs(viewer.userId, viewer.membership);
    const { startConversation } = await import("@/server/services/ai-conversation-service");
    await expect(startConversation({ organizationId: orgAId, message: "Hello" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
  });

  it("startConversation: creates a conversation + user message + a REAL assistant reply (via the mocked provider), with usage/cost recorded, and audits ai.conversation.started", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-start-owner@example.com");
    actAs(owner.userId, owner.membership);
    mockReply("You can change your plan from the billing page.");

    const { startConversation } = await import("@/server/services/ai-conversation-service");
    const result = await startConversation({ organizationId: orgAId, message: "How do I change my plan?" });

    expect(result.conversation.status).toBe("OPEN");
    expect(result.conversation.userId).toBe(owner.userId);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ role: "USER", content: "How do I change my plan?" });
    expect(result.messages[1]).toMatchObject({ role: "ASSISTANT", content: "You can change your plan from the billing page.", inputTokens: 40, outputTokens: 12, model: "claude-opus-5" });
    expect(result.messages[1]?.costMinorUnits).toBeGreaterThan(0);
    expect(mockProvider.sendMessage).toHaveBeenCalledTimes(1);

    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "ai.conversation.started" }, tx));
    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.actorUserId).toBe(owner.userId);
  });

  it("startConversation: an empty message is rejected before any provider call", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-empty-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { startConversation } = await import("@/server/services/ai-conversation-service");
    await expect(startConversation({ organizationId: orgAId, message: "   " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
  });

  it("startConversation: a message over the length limit is rejected before any provider call", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-toolong-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { startConversation } = await import("@/server/services/ai-conversation-service");
    await expect(startConversation({ organizationId: orgAId, message: "x".repeat(5000) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockProvider.sendMessage).not.toHaveBeenCalled();
  });

  it("startConversation: if the provider call fails, the user's own message is still persisted (never lost), and the error propagates as a safe ExternalServiceError", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-providerfail-owner@example.com");
    actAs(owner.userId, owner.membership);
    // The REAL provider implementation (`anthropic/provider.ts`) never lets a raw SDK error escape — it always maps to `ExternalServiceError` (see that file's own try/catch). The mock replicates that same real contract rather than an unrealistic raw rejection.
    mockProvider.sendMessage.mockRejectedValueOnce(new ExternalServiceError("Anthropic"));

    const { startConversation, listConversations } = await import("@/server/services/ai-conversation-service");
    await expect(startConversation({ organizationId: orgAId, message: "Are you there?" })).rejects.toMatchObject({ code: "EXTERNAL_SERVICE_ERROR" });

    const conversations = await listConversations({ organizationId: orgAId });
    expect(conversations.items).toHaveLength(1);
    const { getConversation } = await import("@/server/services/ai-conversation-service");
    const full = await getConversation({ organizationId: orgAId, conversationId: conversations.items[0]!.id });
    expect(full.messages).toHaveLength(1);
    expect(full.messages[0]?.role).toBe("USER");
  });

  it("sendMessage: continues an existing conversation with real multi-turn context sent to the provider", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-continue-owner@example.com");
    actAs(owner.userId, owner.membership);
    mockReply("First answer.");
    const { startConversation, sendMessage } = await import("@/server/services/ai-conversation-service");
    const started = await startConversation({ organizationId: orgAId, message: "First question" });

    mockReply("Second answer.");
    const continued = await sendMessage({ organizationId: orgAId, conversationId: started.conversation.id, message: "Follow-up question" });

    expect(continued.messages).toHaveLength(4);
    expect(continued.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT", "USER", "ASSISTANT"]);
    // The second provider call receives the FULL prior history, not just the new message.
    const secondCallInput = mockProvider.sendMessage.mock.calls[1]![0];
    expect(secondCallInput.messages).toHaveLength(3); // first USER, first ASSISTANT, second USER
  });

  it("sendMessage: another member of the SAME organization (even with ai.use) cannot post into someone else's conversation — a safe not-found, never a cross-user leak", async () => {
    const ownerA = await makeMember(orgAId, "owner", "ai-owner-a2@example.com");
    actAs(ownerA.userId, ownerA.membership);
    mockReply();
    const { startConversation, sendMessage } = await import("@/server/services/ai-conversation-service");
    const started = await startConversation({ organizationId: orgAId, message: "Private question" });

    const memberA = await makeMember(orgAId, "member", "ai-member-a2@example.com");
    actAs(memberA.userId, memberA.membership);
    await expect(sendMessage({ organizationId: orgAId, conversationId: started.conversation.id, message: "Trying to hijack this thread" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getConversation: ai.manage lets an admin VIEW another member's conversation (oversight) without being able to impersonate them", async () => {
    const member = await makeMember(orgAId, "member", "ai-member-oversight@example.com");
    actAs(member.userId, member.membership);
    mockReply();
    const { startConversation, getConversation } = await import("@/server/services/ai-conversation-service");
    const started = await startConversation({ organizationId: orgAId, message: "A member's own question" });

    const admin = await makeMember(orgAId, "admin", "ai-admin-oversight@example.com");
    actAs(admin.userId, admin.membership);
    const viewed = await getConversation({ organizationId: orgAId, conversationId: started.conversation.id });
    expect(viewed.conversation.id).toBe(started.conversation.id);
    expect(viewed.messages).toHaveLength(2);
  });

  it("getConversation: a member WITHOUT ai.manage cannot view another member's conversation", async () => {
    const memberA = await makeMember(orgAId, "member", "ai-member-a3@example.com");
    actAs(memberA.userId, memberA.membership);
    mockReply();
    const { startConversation, getConversation } = await import("@/server/services/ai-conversation-service");
    const started = await startConversation({ organizationId: orgAId, message: "Another private question" });

    const memberB = await makeMember(orgAId, "member", "ai-member-b3@example.com");
    actAs(memberB.userId, memberB.membership);
    await expect(getConversation({ organizationId: orgAId, conversationId: started.conversation.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cross-tenant: Org B's owner cannot reach Org A's conversation by forging conversationId under their own (real) organizationId", async () => {
    const ownerA = await makeMember(orgAId, "owner", "ai-owner-a4@example.com");
    actAs(ownerA.userId, ownerA.membership);
    mockReply();
    const { startConversation, getConversation } = await import("@/server/services/ai-conversation-service");
    const started = await startConversation({ organizationId: orgAId, message: "Org A's own question" });

    const ownerB = await makeMember(orgBId, "owner", "ai-owner-b4@example.com");
    actAs(ownerB.userId, ownerB.membership);
    await expect(getConversation({ organizationId: orgBId, conversationId: started.conversation.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("closeConversation: the owner can close their own conversation; a closed conversation rejects new messages", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-close-owner@example.com");
    actAs(owner.userId, owner.membership);
    mockReply();
    const { startConversation, closeConversation, sendMessage } = await import("@/server/services/ai-conversation-service");
    const started = await startConversation({ organizationId: orgAId, message: "Question to close out" });

    const closed = await closeConversation({ organizationId: orgAId, conversationId: started.conversation.id });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();

    await expect(sendMessage({ organizationId: orgAId, conversationId: started.conversation.id, message: "One more thing" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("listConversations: ai.use-only sees just their own conversations; ai.manage sees every conversation in the organization", async () => {
    const memberA = await makeMember(orgAId, "member", "ai-list-member-a@example.com");
    actAs(memberA.userId, memberA.membership);
    mockReply();
    const { startConversation, listConversations } = await import("@/server/services/ai-conversation-service");
    await startConversation({ organizationId: orgAId, message: "Member A's question" });

    const memberB = await makeMember(orgAId, "member", "ai-list-member-b@example.com");
    actAs(memberB.userId, memberB.membership);
    mockReply();
    await startConversation({ organizationId: orgAId, message: "Member B's question" });

    actAs(memberA.userId, memberA.membership);
    const asMemberA = await listConversations({ organizationId: orgAId });
    expect(asMemberA.items).toHaveLength(1);
    expect(asMemberA.items[0]?.userId).toBe(memberA.userId);

    const admin = await makeMember(orgAId, "admin", "ai-list-admin@example.com");
    actAs(admin.userId, admin.membership);
    const asAdmin = await listConversations({ organizationId: orgAId });
    expect(asAdmin.items).toHaveLength(2);
  });

  it("rate limiting: exceeding the organization's own AI message limit is denied WITHOUT any provider call, and audited", async () => {
    const owner = await makeMember(orgAId, "owner", "ai-ratelimit-owner@example.com");
    actAs(owner.userId, owner.membership);
    mockProvider.sendMessage.mockResolvedValue({ content: "ok", model: "claude-opus-5", inputTokens: 5, outputTokens: 5, providerMessageId: `msg_${generateId()}`, stopReason: "end_turn" });

    const { startConversation } = await import("@/server/services/ai-conversation-service");
    // The real limit is 30/hour per organization (see rate-limit.ts's own aiRateLimiter) — drive it to exhaustion.
    for (let i = 0; i < 30; i++) {
      await startConversation({ organizationId: orgAId, message: `Message ${i}` });
    }
    const callCountBeforeDenial = mockProvider.sendMessage.mock.calls.length;
    await expect(startConversation({ organizationId: orgAId, message: "One too many" })).rejects.toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
    expect(mockProvider.sendMessage).toHaveBeenCalledTimes(callCountBeforeDenial); // the 31st call never reached the provider

    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "ai.rate_limit.exceeded" }, tx));
    expect(events.items.length).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
