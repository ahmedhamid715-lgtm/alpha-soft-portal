import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withPortalCrmReadContext } from "./portal-crm-bridge";
import { projectRepository } from "@/server/repositories/project-repository";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectCommentRepository } from "@/server/repositories/project-comment-repository";
import { projectAttachmentRepository } from "@/server/repositories/project-attachment-repository";
import { calculateProjectProgress, calculateMilestoneProgress, toPortalProgress, type PortalProgress } from "@/lib/projects/progress";
import { NotFoundError } from "@/lib/errors/app-error";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TenantTransactionClient } from "@/lib/tenancy/context";
import type { Project } from "@/generated/prisma/client";
import type { ProjectStatus, ProjectPriority, ProjectTaskStatus } from "@/generated/prisma/client";

/**
 * The Customer Portal's real, customer-safe Project projection (Build 27
 * — Roadmap Module 21). Replaces Build 26's honest "not available yet"
 * placeholder. Reuses `portal-crm-bridge.ts`'s exact elevated-read
 * pattern (Build 26): `requirePermission("portal.access", organizationId)`
 * independently verifies session -> active membership ->
 * ORGANIZATION-scoped authorization for THIS exact organization BEFORE
 * anything here runs; every query below is additionally filtered by that
 * already-verified `organizationId`, never a second, separately-trusted
 * id (see `portal-crm-bridge.ts`'s own top comment for the full trust
 * shape this file inherits).
 *
 * **Critical boundary** (see project-management.md "Customer Portal
 * integration"): this file NEVER returns an internal `Project`/
 * `ProjectTask`/`Milestone`/`ProjectComment`/`ProjectAttachment` row
 * wholesale. Every shape below is a hand-picked, customer-safe subset:
 *   - `DRAFT` projects are excluded entirely — internal staging, not yet
 *     customer-ready (a customer given/guessing a DRAFT project's own id
 *     gets the same `NotFoundError` as a nonexistent one).
 *   - Milestones/tasks are included only when `customerVisible: true`;
 *     subtasks are never shown standalone (root tasks only).
 *   - Comments/attachments are included only when `visibility:
 *     CUSTOMER_VISIBLE` AND (project-level, or attached to a
 *     customer-visible root task) — a customer-visible comment on an
 *     otherwise-hidden internal task is NOT shown, since surfacing it
 *     would leak that hidden task's existence by implication.
 *   - No QA checks, no approvals, no dependency graph, no assignee
 *     identity — internal delivery mechanics, never customer-facing.
 *   - Progress numbers ARE computed from the full, real task set
 *     (including internal-only tasks) — a percentage alone reveals
 *     nothing about hidden task titles/content, and an honest number is
 *     more valuable than an artificially incomplete one.
 */

export interface PortalProjectSummary {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  progress: PortalProgress;
  startDate: Date | null;
  targetEndDate: Date | null;
}

export interface PortalProjectMilestone {
  id: string;
  title: string;
  description: string | null;
  targetDate: Date | null;
  progress: PortalProgress;
  cancelledAt: Date | null;
}

export interface PortalProjectTask {
  id: string;
  /** `null` both for a genuinely milestone-less task AND for a task whose milestone exists but isn't customer-visible (Codex Security Engineer finding L2) — the two cases are indistinguishable on purpose, since surfacing a hidden milestone's own id would disclose its existence. */
  milestoneId: string | null;
  title: string;
  description: string | null;
  status: ProjectTaskStatus;
  priority: ProjectPriority;
  dueDate: Date | null;
}

export interface PortalProjectComment {
  id: string;
  taskId: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
}

export interface PortalProjectAttachment {
  id: string;
  taskId: string | null;
  title: string;
  description: string | null;
  externalUrl: string | null;
  createdAt: Date;
}

export interface PortalProjectDetail {
  project: PortalProjectSummary;
  milestones: PortalProjectMilestone[];
  tasks: PortalProjectTask[];
  comments: PortalProjectComment[];
  attachments: PortalProjectAttachment[];
}

/**
 * `PortalProjectTask` plus the cross-project context `/portal/tasks`
 * needs (which project each task belongs to) — everything else about
 * the "never expose assignee/QA/approvals" boundary above still applies
 * unchanged. See `listMyTasks()`.
 */
export interface PortalTaskSummary extends PortalProjectTask {
  projectId: string;
  projectTitle: string;
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

export async function listMyProjects(rawInput: unknown): Promise<PortalProjectSummary[]> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);

  return withPortalCrmReadContext(context.user!.id, async (tx) => {
    const allProjects = await projectRepository.listForCustomerOrganization(input.organizationId, tx);
    const projects = allProjects.filter((p) => p.status !== "DRAFT");
    if (projects.length === 0) return [];

    const tasks = await projectTaskRepository.listForProjects(projects.map((p) => p.id), tx);
    return projects.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      priority: p.priority,
      progress: toPortalProgress(calculateProjectProgress(tasks.filter((t) => t.projectId === p.id).map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId })))),
      startDate: p.startDate,
      targetEndDate: p.targetEndDate,
    }));
  });
}

/**
 * Build 28 (Task Management, Roadmap Module 22) — the Customer Portal's
 * real "My Tasks" (`/portal/tasks`), replacing Build 26's honest "not
 * available yet" placeholder. Deliberately NOT routed through the
 * internal `global-task-service.ts` aggregator — that surface is
 * platform-staff-only (`task_management.*` permissions are never granted
 * to a customer-portal identity) and spans sources (CRM tasks, internal
 * standalone tasks, staff-only onboarding checklist/requirement items)
 * that must never reach a customer at all. This function instead reuses
 * this file's OWN existing customer-visible-root-task rule directly,
 * scoped across every one of the organization's own non-DRAFT projects
 * in one bounded query (`listCustomerVisibleForOrganization`), never a
 * per-project loop.
 *
 * **Critical boundary** — confirmed during recon (see
 * docs/architecture/task-management.md "Customer Portal — My Tasks"):
 * onboarding checklist items and requirements are EXCLUDED entirely.
 * Neither `CrmClientOnboardingChecklistItem` nor
 * `CrmClientOnboardingRequirement` has any customer-visibility or
 * customer-responsibility field — only internal staff
 * `assignedToUserId`/`responsibleUserId` `User` foreign keys — so there
 * is no safe way to show them to a customer at all.
 *
 * **Visibility is NOT assignment.** A `ProjectTask.assignedToUserId` is
 * an internal staff `User`, never a customer-portal identity — a task
 * appearing here means "you can see this," never "this is assigned to
 * you." This page is never filtered or labeled as the customer's own
 * assigned work, and no email-based inferred assignment is performed.
 */
export async function listMyTasks(rawInput: unknown): Promise<PortalTaskSummary[]> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);

  return withPortalCrmReadContext(context.user!.id, async (tx) => {
    const tasks = await projectTaskRepository.listCustomerVisibleForOrganization(input.organizationId, tx);
    // `milestoneId` is intentionally NOT resolved/shown here (unlike the
    // single-project detail view) — cross-project milestone visibility
    // would require a second bounded query per distinct milestone id
    // for a field this page doesn't otherwise use; omitted rather than
    // adding that cost for no real benefit.
    return tasks.map((t) => ({
      id: t.id,
      milestoneId: null,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      projectId: t.project.id,
      projectTitle: t.project.title,
    }));
  });
}

/**
 * Codex Security Engineer finding L1 — a query-level replacement for
 * `projectRepository.findById()` + an application-layer post-filter.
 * The previous version read the FULL internal `Project` row for ANY
 * forged UUID (under the elevated platform-context transaction, so RLS
 * cannot narrow it — the bridge deliberately sets platform context)
 * before ever checking it belonged to this customer, which was safe in
 * its OBSERVABLE behavior (still a clean `NotFoundError`) but left an
 * unnecessary over-broad privileged read as the only thing standing
 * between a forged id and this customer's own database connection
 * momentarily holding another customer's row. Every predicate this
 * function needs — `customerOrganizationId`, `status != DRAFT` — is now
 * in the query's own `WHERE`, not applied afterward.
 */
async function findPortalVisibleProject(projectId: string, customerOrganizationId: string, tx: TenantTransactionClient): Promise<Project | null> {
  return withDbErrorTranslation(() => tx.project.findFirst({ where: { id: projectId, customerOrganizationId, status: { not: "DRAFT" } } }));
}

const projectIdSchema = z.object({ organizationId: z.string().uuid(), projectId: z.string().uuid() });

export async function getMyProjectDetail(rawInput: unknown): Promise<PortalProjectDetail> {
  const input = parseOrThrow(projectIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);

  return withPortalCrmReadContext(context.user!.id, async (tx) => {
    const project = await findPortalVisibleProject(input.projectId, input.organizationId, tx);
    // A forged id for someone else's project, a nonexistent id, or a
    // real but still-DRAFT project of this customer's own all resolve
    // to the same NotFoundError (IDOR-safe: never distinguishes "not
    // yours" from "doesn't exist").
    if (!project) throw new NotFoundError("Project");

    const [allMilestones, allTasks, allComments, allAttachments] = await Promise.all([
      milestoneRepository.listForProject(project.id, tx),
      projectTaskRepository.listForProject(project.id, tx),
      projectCommentRepository.listForProject(project.id, tx),
      projectAttachmentRepository.listForProject(project.id, tx),
    ]);

    const visibleRootTasks = allTasks.filter((t) => t.customerVisible && t.parentTaskId === null);
    const visibleTaskIds = new Set(visibleRootTasks.map((t) => t.id));
    const visibleMilestones = allMilestones.filter((m) => m.customerVisible);
    const visibleMilestoneIds = new Set(visibleMilestones.map((m) => m.id));

    const milestones = visibleMilestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      targetDate: m.targetDate,
      progress: toPortalProgress(calculateMilestoneProgress(allTasks.filter((t) => t.milestoneId === m.id).map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId })))),
      cancelledAt: m.cancelledAt,
    }));

    // `milestoneId` nulled out unless it belongs to a customer-visible
    // milestone (Codex Security Engineer finding L2) — otherwise a
    // visible task under a hidden milestone would leak that hidden
    // milestone's own id, even though its title/content stays excluded.
    const tasks = visibleRootTasks.map((t) => ({
      id: t.id,
      milestoneId: t.milestoneId && visibleMilestoneIds.has(t.milestoneId) ? t.milestoneId : null,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
    }));

    const comments = allComments
      .filter((c) => c.visibility === "CUSTOMER_VISIBLE" && (c.taskId === null || visibleTaskIds.has(c.taskId)))
      .map((c) => ({ id: c.id, taskId: c.taskId, body: c.body, createdAt: c.createdAt, editedAt: c.editedAt }));

    const attachments = allAttachments
      .filter((a) => a.visibility === "CUSTOMER_VISIBLE" && (a.taskId === null || visibleTaskIds.has(a.taskId)))
      .map((a) => ({ id: a.id, taskId: a.taskId, title: a.title, description: a.description, externalUrl: a.externalUrl, createdAt: a.createdAt }));

    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        priority: project.priority,
        progress: toPortalProgress(calculateProjectProgress(allTasks.map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId })))),
        startDate: project.startDate,
        targetEndDate: project.targetEndDate,
      },
      milestones,
      tasks,
      comments,
      attachments,
    };
  });
}
