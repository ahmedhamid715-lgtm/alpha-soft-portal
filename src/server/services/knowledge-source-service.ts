import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { knowledgeSourceRepository } from "@/server/repositories/knowledge-source-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { KnowledgeSource } from "@/generated/prisma/client";

/**
 * Knowledge source lifecycle (Module 18) — `knowledge.source.manage`
 * for every mutation, `knowledge.source.read` for listing. Mirrors
 * `ai-conversation-service.ts`'s own shape: parse -> authorize ->
 * short `withTenantContext()` transaction -> audit.
 */

const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;

async function auditSourceCreated(context: AuthorizationContext, organizationId: string | null, sourceId: string, sourceName: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.source.created", organizationId, resourceType: "knowledge_source", resourceId: sourceId, resourceName: sourceName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.source.created", error));
}

async function auditSourceUpdated(context: AuthorizationContext, organizationId: string | null, sourceId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.source.updated", organizationId, resourceType: "knowledge_source", resourceId: sourceId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.source.updated", error));
}

async function auditSourceArchived(context: AuthorizationContext, organizationId: string | null, sourceId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.source.archived", organizationId, resourceType: "knowledge_source", resourceId: sourceId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.source.archived", error));
}

const createOrganizationSourceSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  classification: z.enum(CLASSIFICATIONS).default("INTERNAL"),
});

/** `knowledge.source.manage` — creates a new `MANUAL` source owned by this organization. Only `MANUAL` exists today (see schema.prisma's own `KnowledgeSourceType` comment) — no `type` input to accept or validate against a wider set yet. */
export async function createOrganizationSource(rawInput: unknown): Promise<KnowledgeSource> {
  const input = parseOrThrow(createOrganizationSourceSchema, rawInput);
  const context = await requirePermission("knowledge.source.manage", input.organizationId);

  const id = generateId();
  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };
  const source = await withTenantContext(tenantScope, (tx) =>
    knowledgeSourceRepository.create({ id, organizationId: input.organizationId, type: "MANUAL", name: input.name, description: input.description ?? null, classification: input.classification }, tx),
  );

  await auditSourceCreated(context, input.organizationId, id, input.name);
  return source;
}

const createPlatformSourceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  classification: z.enum(CLASSIFICATIONS).default("PUBLIC"),
});

/** `knowledge.platform.manage` — creates a PLATFORM-level source (`organizationId = null`), visible to every organization's retrieval. See ai-knowledge.md "Platform knowledge." */
export async function createPlatformSource(rawInput: unknown): Promise<KnowledgeSource> {
  const input = parseOrThrow(createPlatformSourceSchema, rawInput);
  const context = await requirePermission("knowledge.platform.manage");

  const id = generateId();
  // `isPlatformStaff: true` directly, the same `getPlatformAiUsageSummary()`
  // idiom Module 17 established — `requirePermission()` already
  // performed the real verification; this context is a genuine,
  // verified platform-staff context, not an optimistic assumption.
  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: null, isPlatformStaff: true };
  const source = await withTenantContext(tenantScope, (tx) =>
    knowledgeSourceRepository.create({ id, organizationId: null, type: "MANUAL", name: input.name, description: input.description ?? null, classification: input.classification }, tx),
  );

  await auditSourceCreated(context, null, id, input.name);
  return source;
}

const listOrganizationSourcesSchema = z.object({ organizationId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

/** `knowledge.source.read` — this organization's own sources plus platform-level ones. */
export async function listOrganizationSources(rawInput: unknown): Promise<OffsetPaginatedResult<KnowledgeSource>> {
  const input = parseOrThrow(listOrganizationSourcesSchema, rawInput);
  const context = await requirePermission("knowledge.source.read", input.organizationId);
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };

  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    knowledgeSourceRepository.listForOrganization(input.organizationId, params, tx),
  );
}

const listPlatformSourcesSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

/** `knowledge.platform.manage` — the platform knowledge management surface's own source list. */
export async function listPlatformSources(rawInput: unknown): Promise<OffsetPaginatedResult<KnowledgeSource>> {
  const input = parseOrThrow(listPlatformSourcesSchema, rawInput);
  const context = await requirePermission("knowledge.platform.manage");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };

  return withTenantContext({ userId: context.user!.id, organizationId: null, isPlatformStaff: true }, (tx) => knowledgeSourceRepository.listPlatform(params, tx));
}

const getSourceSchema = z.object({ organizationId: z.string().uuid().nullable(), sourceId: z.string().uuid() });

/** `knowledge.source.read` (organization) or `knowledge.platform.manage` (platform, `organizationId: null`) — a single source, re-verified to actually belong to the claimed scope, never trusted from the URL alone. */
export async function getSource(rawInput: unknown): Promise<KnowledgeSource> {
  const input = parseOrThrow(getSourceSchema, rawInput);
  const context = input.organizationId ? await requirePermission("knowledge.source.read", input.organizationId) : await requirePermission("knowledge.platform.manage");

  const source = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) => knowledgeSourceRepository.findById(input.sourceId, tx));
  if (!source) throw new NotFoundError("Knowledge source");
  // Defense in depth beyond RLS — confirms the resolved row actually
  // belongs to the scope the caller claimed (the same "never trust a
  // client-supplied id pairing alone" discipline `ai-conversation-
  // service.ts`'s own `sendMessage()` doc comment already establishes).
  if (source.organizationId !== input.organizationId) throw new NotFoundError("Knowledge source");
  return source;
}

const updateSourceStatusSchema = z.object({ organizationId: z.string().uuid().nullable(), sourceId: z.string().uuid(), status: z.enum(["ACTIVE", "DISABLED", "ARCHIVED"]) });

/** `knowledge.source.manage` (organization) or `knowledge.platform.manage` (platform). */
export async function updateSourceStatus(rawInput: unknown): Promise<KnowledgeSource> {
  const input = parseOrThrow(updateSourceStatusSchema, rawInput);
  const context = input.organizationId ? await requirePermission("knowledge.source.manage", input.organizationId) : await requirePermission("knowledge.platform.manage");

  const updated = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, async (tx) => {
    const existing = await knowledgeSourceRepository.findById(input.sourceId, tx);
    if (!existing || existing.organizationId !== input.organizationId) throw new NotFoundError("Knowledge source");
    return knowledgeSourceRepository.updateStatus(input.sourceId, input.status, tx);
  });

  if (input.status === "ARCHIVED") await auditSourceArchived(context, input.organizationId, input.sourceId);
  else await auditSourceUpdated(context, input.organizationId, input.sourceId);
  return updated;
}
