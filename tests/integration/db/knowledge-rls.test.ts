import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 18 — direct database-level RLS tests for every new knowledge
 * table, real Postgres, the genuinely restricted `alpha_os_app` role
 * via `withTenantContext()`, never a superuser, never mocked. Same
 * methodology `ai-rls.test.ts`/`billing-rls.test.ts` already establish.
 *
 * `knowledge_sources`/`knowledge_documents`/`knowledge_chunks` are
 * DIRECTLY organization-owned (nullable, platform-shared shape);
 * `knowledge_document_versions`/`knowledge_embeddings` are
 * TRANSITIVELY owned, proven by inserting the parent under Org A's
 * context then attempting the child under Org B's.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Knowledge domain Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;

  async function seed() {
    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "KRLS Org A", displayName: "KRLS Org A", slug: `krls-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "KRLS Org B", displayName: "KRLS Org B", slug: `krls-org-b-${orgBId}` });
    orgIds.push(orgAId, orgBId);
  }
  const seeded = seed();

  afterEach(async () => {
    // Scoped, never a blanket deleteMany({}) — this codebase runs test
    // FILES concurrently against the same real database (see
    // billing-rls.test.ts's own comment).
    await db.knowledgeEmbedding.deleteMany({ where: { chunk: { organizationId: { in: [orgAId, orgBId] } } } });
    await db.knowledgeChunk.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await db.knowledgeDocumentVersion.deleteMany({ where: { document: { organizationId: { in: [orgAId, orgBId] } } } });
    await db.knowledgeDocument.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await db.knowledgeSource.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  });

  async function seedSource(organizationId: string | null, classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" = "INTERNAL") {
    const isPlatform = organizationId === null;
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: isPlatform }, (tx) =>
      tx.knowledgeSource.create({ data: { id: generateId(), organizationId, type: "MANUAL", name: "RLS test source", classification } }),
    );
  }

  describe("knowledge_sources", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seeded;
      await seedSource(orgAId);
      const seen = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.knowledgeSource.findMany({}));
      expect(seen).toEqual([]);
    });

    it("Org B's context cannot SELECT Org A's own source", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeSource.findUnique({ where: { id: source.id } }));
      expect(seenByB).toBeNull();
    });

    it("a zero-WHERE findMany() under Org B's context never returns Org A's sources", async () => {
      await seeded;
      await seedSource(orgAId);
      const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeSource.findMany({}));
      expect(seenByB.every((s) => s.organizationId !== orgAId)).toBe(true);
    });

    it("a forged cross-tenant INSERT (Org B's context, Org A's organizationId) is rejected by WITH CHECK", async () => {
      await seeded;
      await expect(
        withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
          tx.knowledgeSource.create({ data: { id: generateId(), organizationId: orgAId, type: "MANUAL", name: "forged" } }),
        ),
      ).rejects.toThrow();
    });

    it("a non-platform context CANNOT insert a platform-level source (organizationId: null)", async () => {
      await seeded;
      await expect(
        withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
          tx.knowledgeSource.create({ data: { id: generateId(), organizationId: null, type: "MANUAL", name: "forged platform source" } }),
        ),
      ).rejects.toThrow();
    });

    it("platform-level sources (organizationId: null) ARE visible under an ordinary organization's own context — real shared knowledge, not a leak", async () => {
      await seeded;
      const platformSource = await seedSource(null);
      try {
        const seenByOrgA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.knowledgeSource.findUnique({ where: { id: platformSource.id } }));
        expect(seenByOrgA?.id).toBe(platformSource.id);
      } finally {
        await db.knowledgeSource.delete({ where: { id: platformSource.id } });
      }
    });

    it("Org B's context cannot UPDATE Org A's source (filtered to zero rows, not an error)", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const result = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeSource.updateMany({ where: { id: source.id }, data: { status: "ARCHIVED" } }));
      expect(result.count).toBe(0);
      const real = await db.knowledgeSource.findUnique({ where: { id: source.id } });
      expect(real?.status).toBe("ACTIVE");
    });

    it("DELETE is refused outright — REVOKEd at the grant layer (defense-in-depth beyond RLS alone), for every context including the owning organization", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      // Unlike a missing RLS policy alone (which would silently filter
      // to zero affected rows), this table's DELETE privilege is
      // REVOKEd outright from `alpha_os_app` (see the migration's own
      // "Grant-layer defense-in-depth" section) — Postgres refuses the
      // privilege check before RLS is even evaluated, raising a real
      // error rather than a silent no-op. Proven for BOTH a
      // cross-tenant attempt and the owning organization's own context.
      await expect(withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeSource.deleteMany({ where: { id: source.id } }))).rejects.toThrow();
      await expect(withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.knowledgeSource.deleteMany({ where: { id: source.id } }))).rejects.toThrow();
      expect(await db.knowledgeSource.findUnique({ where: { id: source.id } })).not.toBeNull();
    });
  });

  describe("knowledge_documents (direct ownership) and knowledge_document_versions (transitive)", () => {
    it("a document is visible to its own organization, not to another", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const document = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocument.create({ data: { id: generateId(), sourceId: source.id, organizationId: orgAId, title: "RLS doc" } }),
      );

      const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeDocument.findUnique({ where: { id: document.id } }));
      expect(seenByB).toBeNull();
    });

    it("a version is visible only through its document's own organization (transitive), including UPDATE (the real, necessary case — see schema.prisma's own correction note)", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const document = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocument.create({ data: { id: generateId(), sourceId: source.id, organizationId: orgAId, title: "RLS doc for version" } }),
      );
      const version = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocumentVersion.create({ data: { id: generateId(), documentId: document.id, versionNumber: 1, content: "v1", contentChecksum: "abc" } }),
      );

      const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeDocumentVersion.findUnique({ where: { id: version.id } }));
      expect(seenByB).toBeNull();

      // The real UPDATE case this table actually needs (status transitions).
      const updateAsA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.knowledgeDocumentVersion.update({ where: { id: version.id }, data: { status: "READY" } }));
      expect(updateAsA.status).toBe("READY");

      const updateAsB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeDocumentVersion.updateMany({ where: { id: version.id }, data: { status: "FAILED" } }));
      expect(updateAsB.count).toBe(0);
    });

    it("platform staff context can see a customer organization's document — explicit platform visibility, not a bypass", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const document = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocument.create({ data: { id: generateId(), sourceId: source.id, organizationId: orgAId, title: "Visible to platform staff" } }),
      );
      const seenByPlatform = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => tx.knowledgeDocument.findUnique({ where: { id: document.id } }));
      expect(seenByPlatform?.id).toBe(document.id);
    });
  });

  describe("knowledge_chunks (denormalized direct ownership) and knowledge_embeddings (transitive via chunk)", () => {
    it("a chunk is visible only to its own organization; a forged cross-tenant chunk INSERT is rejected", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const document = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocument.create({ data: { id: generateId(), sourceId: source.id, organizationId: orgAId, title: "Doc with chunks" } }),
      );
      const version = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocumentVersion.create({ data: { id: generateId(), documentId: document.id, versionNumber: 1, content: "content", contentChecksum: "abc" } }),
      );
      const chunk = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeChunk.create({ data: { id: generateId(), documentVersionId: version.id, organizationId: orgAId, sequence: 0, content: "chunk content", charCount: 13, chunkingStrategy: "fixed-char-v1", checksum: "x" } }),
      );

      const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeChunk.findUnique({ where: { id: chunk.id } }));
      expect(seenByB).toBeNull();

      await expect(
        withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
          tx.knowledgeChunk.create({ data: { id: generateId(), documentVersionId: version.id, organizationId: orgAId, sequence: 1, content: "forged", charCount: 6, chunkingStrategy: "fixed-char-v1", checksum: "y" } }),
        ),
      ).rejects.toThrow();
    });

    it("an embedding is visible only transitively through its chunk's own organization (real vector column, real raw-SQL insert)", async () => {
      await seeded;
      const source = await seedSource(orgAId);
      const document = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocument.create({ data: { id: generateId(), sourceId: source.id, organizationId: orgAId, title: "Doc with embeddings" } }),
      );
      const version = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeDocumentVersion.create({ data: { id: generateId(), documentId: document.id, versionNumber: 1, content: "content", contentChecksum: "abc" } }),
      );
      const chunk = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.knowledgeChunk.create({ data: { id: generateId(), documentVersionId: version.id, organizationId: orgAId, sequence: 0, content: "chunk content", charCount: 13, chunkingStrategy: "fixed-char-v1", checksum: "x" } }),
      );
      const embeddingId = generateId();
      const vectorLiteral = `[${new Array(1536).fill(0).join(",")}]`;
      await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
        tx.$executeRaw`INSERT INTO knowledge_embeddings (id, chunk_id, provider, model, dimension, vector, created_at) VALUES (${embeddingId}::uuid, ${chunk.id}::uuid, 'openai', 'text-embedding-3-small', 1536, ${vectorLiteral}::vector, now())`,
      );

      const seenByA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.knowledgeEmbedding.findUnique({ where: { id: embeddingId } }));
      expect(seenByA?.id).toBe(embeddingId);

      const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.knowledgeEmbedding.findUnique({ where: { id: embeddingId } }));
      expect(seenByB).toBeNull();
    });
  });
});
