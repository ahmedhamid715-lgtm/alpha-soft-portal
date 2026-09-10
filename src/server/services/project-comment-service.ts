import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope } from "./project-shared";
import { projectRepository } from "@/server/repositories/project-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectCommentRepository } from "@/server/repositories/project-comment-repository";
import { NotFoundError, ValidationError, AuthorizationError } from "@/lib/errors/app-error";
import type { ProjectComment } from "@/generated/prisma/client";

/**
 * Project/task comments (Build 27 — Roadmap Module 21). Plain text only
 * — see `ProjectComment`'s own schema comment; clients render `body` as
 * a text node, never `dangerouslySetInnerHTML`, so no HTML sanitizer is
 * needed and a comment body is NEVER written into audit metadata (a
 * comment is not a material audited action at all — see
 * project-management.md "Audit"). **Critical boundary**: `visibility`
 * defaults to `INTERNAL` and is always an explicit, staff-chosen value —
 * never inferred from the author's own role (decision "Internal vs.
 * customer-visible comments"). Customers never get a comment-creation
 * path in this build (Build 26's own Portal "Messages" section remains
 * honestly unavailable) — only staff write comments; Portal only ever
 * READS `CUSTOMER_VISIBLE` ones.
 */

const addCommentSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid().nullable().optional(), body: z.string().trim().min(1).max(5000), visibility: z.enum(["INTERNAL", "CUSTOMER_VISIBLE"]).default("INTERNAL") });

export async function addComment(rawInput: unknown): Promise<ProjectComment> {
  const input = parseOrThrow(addCommentSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const project = await projectRepository.findById(input.projectId, tx);
    if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");
    if (input.taskId) {
      const task = await projectTaskRepository.findById(input.taskId, tx);
      if (!task || task.projectId !== input.projectId) throw new ValidationError("taskId does not belong to this project.");
    }
    return projectCommentRepository.create({ id: generateId(), organizationId, projectId: input.projectId, taskId: input.taskId ?? null, authorUserId: context.user!.id, body: input.body, visibility: input.visibility }, tx);
  });
}

const editCommentSchema = z.object({ commentId: z.string().uuid(), body: z.string().trim().min(1).max(5000) });

/** Author-only — an editor who didn't write the comment is rejected regardless of their own `delivery_projects.manage` grant (comments are personal statements, not shared operational state). */
export async function editComment(rawInput: unknown): Promise<ProjectComment> {
  const input = parseOrThrow(editCommentSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await projectCommentRepository.findById(input.commentId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Comment");
    if (existing.authorUserId !== context.user!.id) throw new AuthorizationError("You can only edit your own comments.");
    return projectCommentRepository.edit(input.commentId, input.body, tx);
  });
}
