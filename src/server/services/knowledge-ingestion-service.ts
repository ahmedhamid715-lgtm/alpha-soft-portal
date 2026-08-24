import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { knowledgeSourceRepository } from "@/server/repositories/knowledge-source-repository";
import { knowledgeDocumentRepository } from "@/server/repositories/knowledge-document-repository";
import { knowledgeChunkRepository } from "@/server/repositories/knowledge-chunk-repository";
import { knowledgeEmbeddingRepository } from "@/server/repositories/knowledge-embedding-repository";
import { chunkText, CHUNKING_STRATEGY } from "@/lib/knowledge/chunking";
import { openAiEmbeddingProvider } from "@/lib/knowledge/embedding/openai/provider";
import { embeddingModel } from "@/lib/knowledge/embedding/openai/client";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ExternalServiceError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { KnowledgeDocument, KnowledgeDocumentVersion } from "@/generated/prisma/client";

/**
 * Document ingestion / versioning / re-indexing / deletion (Module 18).
 *
 * **Text-only ingestion — an honest limitation.** This module ingests
 * plain text: pasted directly, or read server-side from an uploaded
 * `.txt`/`.md` file (`FormData`'s own `.text()`, no persistent binary
 * storage, no OCR, no PDF/Office-format parsing — Module 56 (File
 * Storage) does not exist yet, and building a parsing pipeline for
 * arbitrary binary formats would be exactly the "full document
 * management platform" / "OCR platform" spec §32 explicitly forbids).
 * A future connector (once Module 56 exists) would populate this SAME
 * `content` field from its own extraction pipeline — this module's
 * ingestion contract doesn't change.
 *
 * **`processDocumentVersion()` is the async-job contract** (spec §15:
 * "create the contract a future job system can execute," not a full
 * durable queue — no dedicated background-job module exists yet).
 * Called SYNCHRONOUSLY, inline, from `ingestText()`/`reindexDocument()`
 * in this dev/current-deployment environment — real, immediate
 * feedback, honestly not backed by a queue. Written to be safely
 * callable standalone by (id) alone, so a future job system can invoke
 * it exactly the same way without this function changing.
 */

const MAX_CONTENT_CHARS = 200_000; // ~50k tokens by the ~4-chars/token estimate — a real, enforced cap (spec §18 "oversized document/chunk payloads").
const EMBEDDING_PROVIDER = "openai";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function auditDocumentIngested(context: AuthorizationContext, organizationId: string | null, documentId: string, title: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.document.ingested", organizationId, resourceType: "knowledge_document", resourceId: documentId, resourceName: title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.document.ingested", error));
}

async function auditIngestionFailed(context: AuthorizationContext, organizationId: string | null, documentId: string, reason: string): Promise<void> {
  await audit
    .recordFailure({ action: "knowledge.document.ingestion_failed", organizationId, resourceType: "knowledge_document", resourceId: documentId, metadata: { reason }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.document.ingestion_failed", error));
}

async function auditDocumentDeleted(context: AuthorizationContext, organizationId: string | null, documentId: string, title: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.document.deleted", organizationId, resourceType: "knowledge_document", resourceId: documentId, resourceName: title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.document.deleted", error));
}

async function auditDocumentReindexed(context: AuthorizationContext, organizationId: string | null, documentId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.document.reindexed", organizationId, resourceType: "knowledge_document", resourceId: documentId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.document.reindexed", error));
}

/**
 * Chunks (if not already chunked under `CHUNKING_STRATEGY`) and embeds
 * (if not already embedded under the CURRENT provider/model) one
 * document version. Safe to call more than once on the same version —
 * idempotent per (version, strategy) and per (chunk, provider, model):
 * a version already fully indexed under today's strategy/model is a
 * cheap no-op; a version whose strategy OR model changed since it was
 * last indexed gets the missing rows added (spec §16 — re-indexing adds
 * rows, never mutates/deletes old ones).
 */
async function processDocumentVersion(versionId: string, tenantScope: TenantContextInput): Promise<{ status: "READY" | "FAILED"; chunkCount: number }> {
  const existingChunks = await withTenantContext(tenantScope, (tx) => knowledgeChunkRepository.listForVersion(versionId, CHUNKING_STRATEGY, tx));

  let chunkIds: { id: string; content: string }[];
  if (existingChunks.length > 0) {
    chunkIds = existingChunks.map((c) => ({ id: c.id, content: c.content }));
  } else {
    await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.updateVersionStatus(versionId, "CHUNKING", {}, tx));
    const version = await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.findVersionById(versionId, tx));
    if (!version) throw new NotFoundError("Document version");

    const rawChunks = chunkText(version.content);
    if (rawChunks.length === 0) {
      await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.updateVersionStatus(versionId, "FAILED", { failureReason: "No content to chunk." }, tx));
      return { status: "FAILED", chunkCount: 0 };
    }

    const rows = rawChunks.map((c) => ({
      id: generateId(),
      documentVersionId: versionId,
      organizationId: tenantScope.organizationId,
      sequence: c.sequence,
      content: c.content,
      charCount: c.charCount,
      tokenCount: c.tokenCount,
      checksum: c.checksum,
      chunkingStrategy: CHUNKING_STRATEGY,
    }));
    await withTenantContext(tenantScope, (tx) => knowledgeChunkRepository.createMany(rows, tx));
    chunkIds = rows.map((r) => ({ id: r.id, content: r.content }));
  }

  const model = embeddingModel();
  // Which of these chunks already have an embedding for the CURRENT
  // (provider, model)? Re-fetch fresh rather than trust the in-memory
  // `existingChunks` list, which may predate a model change.
  const alreadyEmbeddedIds = new Set(
    (await withTenantContext(tenantScope, (tx) => knowledgeChunkRepository.findByIdsWithEmbeddings(chunkIds.map((c) => c.id), tx)))
      .filter((c) => c.embeddings.some((e) => e.provider === EMBEDDING_PROVIDER && e.model === model))
      .map((c) => c.id),
  );
  const toEmbed = chunkIds.filter((c) => !alreadyEmbeddedIds.has(c.id));

  if (toEmbed.length > 0) {
    await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.updateVersionStatus(versionId, "EMBEDDING", {}, tx));
    let embedResult;
    try {
      // The external network call — deliberately OUTSIDE any
      // transaction, the exact same "create local state, call the
      // provider, reconcile after" shape `ai-conversation-service.ts`'s
      // `generateAssistantReply()` already establishes.
      embedResult = await openAiEmbeddingProvider.embed({ texts: toEmbed.map((c) => c.content) });
    } catch (error) {
      const reason = error instanceof ExternalServiceError ? "Embedding provider unavailable." : "Embedding failed.";
      await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.updateVersionStatus(versionId, "FAILED", { failureReason: reason }, tx));
      return { status: "FAILED", chunkCount: chunkIds.length };
    }

    await withTenantContext(tenantScope, (tx) =>
      knowledgeEmbeddingRepository.createMany(
        embedResult.items.map((item) => ({ id: generateId(), chunkId: toEmbed[item.index].id, provider: EMBEDDING_PROVIDER, model: embedResult.model, dimension: embedResult.dimension, vector: item.vector })),
        tx,
      ),
    );
  }

  await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.updateVersionStatus(versionId, "READY", { chunkCount: chunkIds.length, readyAt: new Date() }, tx));
  return { status: "READY", chunkCount: chunkIds.length };
}

const ingestTextSchema = z.object({
  organizationId: z.string().uuid().nullable(),
  sourceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
  canonicalId: z.string().max(500).nullable().optional(),
});

/**
 * `knowledge.source.manage` (organization) or `knowledge.platform.manage`
 * (platform, `organizationId: null`). Idempotent (spec §15): re-ingesting
 * identical content under the same `canonicalId` is a genuine no-op —
 * returns the EXISTING ready version rather than creating a duplicate
 * logical document, verified directly by a dedicated integration test.
 */
export async function ingestText(rawInput: unknown): Promise<{ document: KnowledgeDocument; version: KnowledgeDocumentVersion; deduplicated: boolean }> {
  const input = parseOrThrow(ingestTextSchema, rawInput);
  const context = input.organizationId ? await requirePermission("knowledge.source.manage", input.organizationId) : await requirePermission("knowledge.platform.manage");
  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };
  const checksum = sha256(input.content);

  const { document, version, deduplicated } = await withTenantContext(tenantScope, async (tx) => {
    const source = await knowledgeSourceRepository.findById(input.sourceId, tx);
    if (!source || source.organizationId !== input.organizationId) throw new NotFoundError("Knowledge source");
    if (source.status !== "ACTIVE") throw new ValidationError("This knowledge source is not active.");

    let document = input.canonicalId ? await knowledgeDocumentRepository.findBySourceAndCanonicalId(input.sourceId, input.canonicalId, tx) : null;

    if (document) {
      const latest = await knowledgeDocumentRepository.findLatestVersion(document.id, tx);
      if (latest && latest.contentChecksum === checksum && latest.status !== "FAILED") {
        return { document, version: latest, deduplicated: true };
      }
    } else {
      document = await knowledgeDocumentRepository.create(
        { id: generateId(), sourceId: input.sourceId, organizationId: input.organizationId, title: input.title, canonicalId: input.canonicalId ?? null, contentType: "text/plain" },
        tx,
      );
    }

    const priorVersions = await knowledgeDocumentRepository.listVersionsForDocument(document.id, tx);
    const versionNumber = priorVersions.length + 1;
    const version = await knowledgeDocumentRepository.createVersion({ id: generateId(), documentId: document.id, versionNumber, content: input.content, contentChecksum: checksum, sourceMetadata: null }, tx);
    return { document, version, deduplicated: false };
  });

  if (deduplicated) return { document, version, deduplicated: true };

  const result = await processDocumentVersion(version.id, tenantScope);

  if (result.status === "READY") {
    await withTenantContext(tenantScope, async (tx) => {
      const currentDoc = await knowledgeDocumentRepository.findById(document.id, tx);
      if (currentDoc?.currentVersionId && currentDoc.currentVersionId !== version.id) {
        await knowledgeDocumentRepository.markSuperseded(currentDoc.currentVersionId, tx);
      }
      await knowledgeDocumentRepository.setCurrentVersion(document.id, version.id, tx);
    });
    await auditDocumentIngested(context, input.organizationId, document.id, input.title);
  } else {
    await auditIngestionFailed(context, input.organizationId, document.id, "Embedding step failed — see the version's own failureReason.");
  }

  // Re-fetch both — `document` in scope here is a stale pre-ingestion
  // snapshot (its `currentVersionId` predates the update above); the
  // caller should always see the document/version's real, current
  // state, not what was true before this function's own side effects
  // ran. Found by this module's own integration tests, not inspection.
  const [finalDocument, finalVersion] = await Promise.all([
    withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.findById(document.id, tx)),
    withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.findVersionById(version.id, tx)),
  ]);
  return { document: finalDocument ?? document, version: finalVersion ?? version, deduplicated: false };
}

const reindexDocumentSchema = z.object({ organizationId: z.string().uuid().nullable(), documentId: z.string().uuid() });

/** `knowledge.source.manage` (organization) or `knowledge.platform.manage` (platform) — re-runs chunking/embedding for the CURRENT version under today's `CHUNKING_STRATEGY`/embedding model. See `processDocumentVersion()`'s own doc comment for why this is safe to call even when nothing has actually changed. */
export async function reindexDocument(rawInput: unknown): Promise<{ version: KnowledgeDocumentVersion }> {
  const input = parseOrThrow(reindexDocumentSchema, rawInput);
  const context = input.organizationId ? await requirePermission("knowledge.source.manage", input.organizationId) : await requirePermission("knowledge.platform.manage");
  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };

  const document = await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.findById(input.documentId, tx));
  if (!document || document.organizationId !== input.organizationId) throw new NotFoundError("Document");
  if (!document.currentVersionId) throw new ValidationError("This document has no ready version to re-index yet.");

  await processDocumentVersion(document.currentVersionId, tenantScope);
  const version = await withTenantContext(tenantScope, (tx) => knowledgeDocumentRepository.findVersionById(document.currentVersionId!, tx));
  if (!version) throw new NotFoundError("Document version");

  await auditDocumentReindexed(context, input.organizationId, document.id);
  return { version };
}

const deleteDocumentSchema = z.object({ organizationId: z.string().uuid().nullable(), documentId: z.string().uuid() });

/**
 * `knowledge.source.manage` (organization) or `knowledge.platform.manage`
 * (platform) — soft delete (`Softdeletable`, see schema.prisma). Chunks/
 * embeddings/versions are NOT cascade-deleted (they remain for a
 * possible future restore) but become genuinely unreachable through
 * every retrieval/listing path, which all filter `deletedAt IS NULL` —
 * proven directly by `knowledge-security.md`'s own dedicated test.
 */
export async function deleteDocument(rawInput: unknown): Promise<KnowledgeDocument> {
  const input = parseOrThrow(deleteDocumentSchema, rawInput);
  const context = input.organizationId ? await requirePermission("knowledge.source.manage", input.organizationId) : await requirePermission("knowledge.platform.manage");
  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };

  const { deleted, title } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await knowledgeDocumentRepository.findById(input.documentId, tx);
    if (!existing || existing.organizationId !== input.organizationId) throw new NotFoundError("Document");
    const deleted = await knowledgeDocumentRepository.softDelete(input.documentId, context.user!.id, tx);
    return { deleted, title: existing.title };
  });

  await auditDocumentDeleted(context, input.organizationId, input.documentId, title);
  return deleted;
}
