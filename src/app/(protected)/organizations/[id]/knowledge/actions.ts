"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createOrganizationSource, updateSourceStatus } from "@/server/services/knowledge-source-service";
import { ingestText, reindexDocument, deleteDocument } from "@/server/services/knowledge-ingestion-service";
import { retrieveKnowledge, type RetrievalResult } from "@/server/services/knowledge-retrieval-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import type { KnowledgeSource, KnowledgeDocument, KnowledgeDocumentVersion } from "@/generated/prisma/client";

export interface SourceActionState {
  error?: string;
  source?: KnowledgeSource;
}

const createSourceSchema = z.object({ organizationId: z.string().uuid(), name: z.string().min(1).max(200), description: z.string().max(2000).optional(), classification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]) });

export async function createSourceAction(input: unknown): Promise<SourceActionState> {
  const parsed = safeParseResult(createSourceSchema, input);
  if (!parsed.success) return { error: "Invalid source details." };

  try {
    const source = await createOrganizationSource({ ...parsed.data, description: parsed.data.description ?? null });
    revalidatePath(`/organizations/${parsed.data.organizationId}/knowledge`);
    return { source };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

const archiveSourceSchema = z.object({ organizationId: z.string().uuid(), sourceId: z.string().uuid() });

export async function archiveSourceAction(input: unknown): Promise<SourceActionState> {
  const parsed = safeParseResult(archiveSourceSchema, input);
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const source = await updateSourceStatus({ ...parsed.data, status: "ARCHIVED" });
    revalidatePath(`/organizations/${parsed.data.organizationId}/knowledge`);
    return { source };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface IngestActionState {
  error?: string;
  document?: KnowledgeDocument;
  version?: KnowledgeDocumentVersion;
  deduplicated?: boolean;
}

const ingestSchema = z.object({ organizationId: z.string().uuid(), sourceId: z.string().uuid(), title: z.string().min(1).max(300), content: z.string().min(1), canonicalId: z.string().max(500).optional() });

export async function ingestTextAction(input: unknown): Promise<IngestActionState> {
  const parsed = safeParseResult(ingestSchema, input);
  if (!parsed.success) return { error: "Invalid document — title and content are required." };

  try {
    const result = await ingestText({ ...parsed.data, canonicalId: parsed.data.canonicalId ?? null });
    revalidatePath(`/organizations/${parsed.data.organizationId}/knowledge/${parsed.data.sourceId}`);
    return { document: result.document, version: result.version, deduplicated: result.deduplicated };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface DocumentActionState {
  error?: string;
  document?: KnowledgeDocument;
  version?: KnowledgeDocumentVersion;
}

const reindexSchema = z.object({ organizationId: z.string().uuid(), sourceId: z.string().uuid(), documentId: z.string().uuid() });

export async function reindexDocumentAction(input: unknown): Promise<DocumentActionState> {
  const parsed = safeParseResult(reindexSchema, input);
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const result = await reindexDocument({ organizationId: parsed.data.organizationId, documentId: parsed.data.documentId });
    revalidatePath(`/organizations/${parsed.data.organizationId}/knowledge/${parsed.data.sourceId}/${parsed.data.documentId}`);
    return { version: result.version };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

const deleteSchema = z.object({ organizationId: z.string().uuid(), sourceId: z.string().uuid(), documentId: z.string().uuid() });

export async function deleteDocumentAction(input: unknown): Promise<DocumentActionState> {
  const parsed = safeParseResult(deleteSchema, input);
  if (!parsed.success) return { error: "Invalid request." };

  try {
    const document = await deleteDocument({ organizationId: parsed.data.organizationId, documentId: parsed.data.documentId });
    revalidatePath(`/organizations/${parsed.data.organizationId}/knowledge/${parsed.data.sourceId}`);
    return { document };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export interface SearchActionState {
  error?: string;
  result?: RetrievalResult;
}

const searchSchema = z.object({ organizationId: z.string().uuid(), query: z.string().min(1).max(2000) });

export async function searchKnowledgeAction(input: unknown): Promise<SearchActionState> {
  const parsed = safeParseResult(searchSchema, input);
  if (!parsed.success) return { error: "Enter a search query." };

  try {
    const result = await retrieveKnowledge(parsed.data);
    return { result };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
