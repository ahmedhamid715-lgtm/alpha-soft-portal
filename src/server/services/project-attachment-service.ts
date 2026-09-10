import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope } from "./project-shared";
import { projectRepository } from "@/server/repositories/project-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectAttachmentRepository } from "@/server/repositories/project-attachment-repository";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { ProjectAttachment } from "@/generated/prisma/client";

/**
 * Project/task attachment METADATA (Build 27 — Roadmap Module 21). This
 * build has no real file storage infrastructure (Roadmap Module 56 does
 * not exist yet) — `fileKey` is always null; `externalUrl` is a
 * staff-entered link to an already-hosted file, validated as a real
 * `https://` URL at this boundary (never a filesystem path, never
 * trusted as "safe" just because it parses as a URL — see
 * project-management.md "Attachments"). Do NOT fake an upload flow here.
 */

function assertSafeExternalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("externalUrl must be a valid, fully-qualified URL.");
  }
  if (parsed.protocol !== "https:") throw new ValidationError("externalUrl must use https://.");
}

const addAttachmentSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  externalUrl: z.string().trim().max(2000).nullable().optional(),
  visibility: z.enum(["INTERNAL", "CUSTOMER_VISIBLE"]).default("INTERNAL"),
});

export async function addAttachment(rawInput: unknown): Promise<ProjectAttachment> {
  const input = parseOrThrow(addAttachmentSchema, rawInput);
  if (input.externalUrl) assertSafeExternalUrl(input.externalUrl);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const project = await projectRepository.findById(input.projectId, tx);
    if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");
    if (input.taskId) {
      const task = await projectTaskRepository.findById(input.taskId, tx);
      if (!task || task.projectId !== input.projectId) throw new ValidationError("taskId does not belong to this project.");
    }
    return projectAttachmentRepository.create(
      { id: generateId(), organizationId, projectId: input.projectId, taskId: input.taskId ?? null, title: input.title, description: input.description ?? null, externalUrl: input.externalUrl ?? null, visibility: input.visibility, uploadedByUserId: context.user!.id },
      tx,
    );
  });
}
