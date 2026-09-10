import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError, NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { projectRepository } from "@/server/repositories/project-repository";
import type { Project } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Shared Project Management authorization/tenant-scope resolution —
 * mirrors `crm-shared.ts`'s own `resolveCrmScope()` exactly (same
 * shape, same reasoning): `projects.*` are PLATFORM-scope permissions
 * (Project Management is Alpha Page Rankers' own internal delivery
 * tool, never a customer organization's own data — see permissions.ts's
 * own comment), so `requirePermission()` always resolves
 * `resolvePlatformContext()`, and every Project row's `organizationId`
 * is always that same resolved platform organization id. A separate,
 * Project-Management-owned function rather than importing
 * `resolveCrmScope()` directly — Project Management is its own domain,
 * not a CRM sub-module, even though the underlying pattern is
 * identical.
 */
export interface ProjectScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveProjectScope(permission: PermissionKey): Promise<ProjectScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}

/**
 * The ONE shared serialization point for every mutation that reads or
 * writes anything whose truth affects `evaluateProjectCompletionCriteria()`
 * — task/subtask create+transition+complete+cancel, milestone create+
 * cancel, QA check create+record, approval request+decide, and dependency
 * creation. Locks the owning `Project` row (`SELECT ... FOR UPDATE`) and
 * rejects outright once the project has reached a terminal status
 * (`COMPLETED`/`CANCELLED`/`ARCHIVED`).
 *
 * Found by Codex Security Engineer (Build 27 review, findings H1/H2/M3):
 * without this, (a) `completeProject()`'s own row lock never actually
 * serialized against these child mutations (a row lock only serializes
 * transactions that lock the SAME row — every child service previously
 * read the project via a plain, unlocked `findById()`), letting a
 * completion race a concurrent task reopen/QA-creation/approval-request
 * and commit from an already-stale snapshot; and (b) nothing stopped an
 * ordinary `delivery_projects.manage` caller from adding new required
 * work to an ALREADY-`COMPLETED` project after the fact, silently
 * invalidating the very criteria that were just satisfied — bypassing
 * the documented rule that only `completeProjectOverride()` may leave a
 * project completed with unmet criteria. Every call site below now takes
 * this SAME lock before its own read-then-write, so a concurrent
 * completion and a concurrent child mutation always serialize against
 * each other rather than interleave — the identical mechanism
 * `lockActiveOnboarding()` (Build 23) already established for this exact
 * class of bug in a different domain.
 */
export async function lockMutableProject(projectId: string, organizationId: string, tx: TransactionClient): Promise<Project> {
  const project = await projectRepository.findByIdLocked(projectId, tx);
  if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");
  if (project.status === "COMPLETED" || project.status === "CANCELLED" || project.status === "ARCHIVED") {
    throw new ValidationError(`This project is ${project.status} and no longer accepts new or changed delivery work. Reopen it first if this is genuinely intentional.`);
  }
  return project;
}
