"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createPlatformSource } from "@/server/services/knowledge-source-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import type { KnowledgeSource } from "@/generated/prisma/client";

export interface PlatformSourceActionState {
  error?: string;
  source?: KnowledgeSource;
}

const createSchema = z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional(), classification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]) });

export async function createPlatformSourceAction(input: unknown): Promise<PlatformSourceActionState> {
  const parsed = safeParseResult(createSchema, input);
  if (!parsed.success) return { error: "Invalid source details." };

  try {
    const source = await createPlatformSource({ ...parsed.data, description: parsed.data.description ?? null });
    revalidatePath("/admin/ai/knowledge");
    return { source };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
