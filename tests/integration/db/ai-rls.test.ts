import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 17 — direct database-level RLS tests for `ai_conversations`/
 * `ai_messages`, real Postgres, the genuinely restricted `alpha_os_app`
 * role via `withTenantContext()`, never a superuser, never mocked. Same
 * methodology `billing-rls.test.ts` already established: `ai_conversations`
 * is DIRECTLY organization-owned; `ai_messages` is TRANSITIVELY
 * organization-owned (via `conversation_id`), proven by inserting the
 * parent under Org A's context, then attempting the child under Org B's.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("AI domain Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let userAId: string;

  async function seed() {
    orgAId = generateId();
    orgBId = generateId();
    userAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "AI RLS Org A", displayName: "AI RLS Org A", slug: `ai-rls-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "AI RLS Org B", displayName: "AI RLS Org B", slug: `ai-rls-org-b-${orgBId}` });
    await userRepository.create({ id: userAId, email: `ai-rls-user-a-${userAId}@example.com`, name: "AI RLS User A" });
    orgIds.push(orgAId, orgBId);
    userIds.push(userAId);
  }
  const seeded = seed();

  afterEach(async () => {
    // Per-test cleanup scoped to THIS file's own orgs — never a blanket
    // deleteMany({}) (see billing-rls.test.ts's own comment on why: this
    // codebase runs test FILES concurrently against the same real
    // database).
    await db.aiMessage.deleteMany({ where: { conversation: { organizationId: { in: [orgAId, orgBId] } } } });
    await db.aiConversation.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  });

  async function seedConversation(organizationId: string, userId: string) {
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) => tx.aiConversation.create({ data: { id: generateId(), organizationId, userId, title: "RLS test conversation" } }));
  }

  it("Org B's context cannot SELECT Org A's conversation", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);

    const seenByA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.aiConversation.findUnique({ where: { id: conversation.id } }));
    expect(seenByA?.id).toBe(conversation.id);

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiConversation.findUnique({ where: { id: conversation.id } }));
    expect(seenByB).toBeNull();
  });

  it("a zero-WHERE findMany() under Org B's context never returns Org A's conversations", async () => {
    await seeded;
    await seedConversation(orgAId, userAId);
    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiConversation.findMany({}));
    expect(seenByB).toEqual([]);
  });

  it("Org B's context cannot UPDATE Org A's conversation (filtered to zero rows)", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);

    const result = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiConversation.updateMany({ where: { id: conversation.id }, data: { status: "CLOSED" } }));
    expect(result.count).toBe(0);

    const real = await db.aiConversation.findUnique({ where: { id: conversation.id } });
    expect(real?.status).toBe("OPEN");
  });

  it("a forged cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await seeded;
    const id = generateId();
    await expect(
      withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiConversation.create({ data: { id, organizationId: orgAId, userId: userAId, title: "Forged" } })),
    ).rejects.toBeDefined();
  });

  it("no DELETE policy exists at all — a conversation cannot be deleted even by its own organization's context", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);
    const result = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.aiConversation.deleteMany({ where: { id: conversation.id } }));
    expect(result.count).toBe(0);
    expect(await db.aiConversation.findUnique({ where: { id: conversation.id } })).not.toBeNull();
  });

  it("platform context can SELECT any organization's conversation", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);
    const seenByPlatform = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => tx.aiConversation.findUnique({ where: { id: conversation.id } }));
    expect(seenByPlatform?.id).toBe(conversation.id);
  });

  it("NO tenant context at all fails closed — zero rows visible", async () => {
    await seeded;
    await seedConversation(orgAId, userAId);
    const count = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.aiConversation.count());
    expect(count).toBe(0);
  });

  // --- ai_messages (transitively organization-owned via conversation_id) ----

  it("ai_messages: transitively scoped through conversation_id — Org B's context cannot see Org A's conversation's messages", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);
    const message = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => tx.aiMessage.create({ data: { id: generateId(), conversationId: conversation.id, role: "USER", content: "Hello" } }));

    const seenByA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.aiMessage.findUnique({ where: { id: message.id } }));
    expect(seenByA?.id).toBe(message.id);

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiMessage.findUnique({ where: { id: message.id } }));
    expect(seenByB).toBeNull();

    const zeroWhereByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiMessage.findMany({}));
    expect(zeroWhereByB).toEqual([]);
  });

  it("ai_messages: a forged cross-tenant INSERT (Org B inserting into Org A's conversation) is rejected by WITH CHECK", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);
    const id = generateId();
    await expect(
      withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.aiMessage.create({ data: { id, conversationId: conversation.id, role: "USER", content: "Forged" } })),
    ).rejects.toBeDefined();
  });

  it("ai_messages: no UPDATE/DELETE policy exists at all — immutable, even for the owning organization's own context", async () => {
    await seeded;
    const conversation = await seedConversation(orgAId, userAId);
    const message = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => tx.aiMessage.create({ data: { id: generateId(), conversationId: conversation.id, role: "USER", content: "Original" } }));

    const updateResult = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.aiMessage.updateMany({ where: { id: message.id }, data: { content: "Edited" } }));
    expect(updateResult.count).toBe(0);

    const deleteResult = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.aiMessage.deleteMany({ where: { id: message.id } }));
    expect(deleteResult.count).toBe(0);

    const real = await db.aiMessage.findUnique({ where: { id: message.id } });
    expect(real?.content).toBe("Original");
  });
});
