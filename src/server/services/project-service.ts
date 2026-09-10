import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope } from "./project-shared";
import { assertPlatformStaffMember } from "./crm-shared";
import { projectRepository } from "@/server/repositories/project-repository";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectTaskDependencyRepository } from "@/server/repositories/project-task-dependency-repository";
import { projectCommentRepository } from "@/server/repositories/project-comment-repository";
import { projectAttachmentRepository } from "@/server/repositories/project-attachment-repository";
import { projectApprovalRepository } from "@/server/repositories/project-approval-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { projectTemplateRepository, projectTemplateMilestoneRepository, projectTemplateTaskRepository, projectTemplateQaCheckRepository } from "@/server/repositories/project-template-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { calculateMilestoneProgress, calculateProjectProgress, evaluateProjectCompletionCriteria, type ProjectProgress, type ProjectCompletionResult } from "@/lib/projects/progress";
import { canTransitionProject, type ProjectStatus } from "@/lib/projects/lifecycle";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { Project, Milestone, ProjectTask, ProjectTaskDependency, ProjectComment, ProjectAttachment, ProjectApproval, ProjectQaCheck, CrmCompany, Organization } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Project lifecycle, creation (manual / onboarding handoff / template
 * instantiation), and completion (Build 27 — Roadmap Module 21). See
 * docs/architecture/project-management.md for the full design. Every
 * mutation requires `delivery_projects.manage`; listing/viewing requires
 * `delivery_projects.read`; the privileged completion override additionally
 * requires `delivery_projects.approve` (a deliberately separate authority from
 * ordinary mutation — see `completeProjectOverride()`'s own comment).
 */

function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function auditProject(
  context: AuthorizationContext,
  action: "projects.created" | "projects.lifecycle_transitioned" | "projects.completed_override" | "projects.owner_changed" | "projects.template_instantiated",
  organizationId: string,
  project: Project,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "project", resourceId: project.id, resourceName: project.title, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

interface ProjectAssignedPayload {
  projectId: string;
  organizationId: string;
  recipientUserId: string;
  projectTitle: string;
}
interface ProjectCompletedPayload {
  projectId: string;
  organizationId: string;
  recipientUserId: string;
  projectTitle: string;
}

/** Validates `companyId` is a real, platform-owned `CrmCompany` already converted to EXACTLY `customerOrganizationId` — the structural check that prevents a caller from pairing an unrelated company/organization (decision "Project↔CrmCompany" / "Project↔Organization"). Never creates a company/organization as a side effect. */
async function resolveConsistentCompany(companyId: string, customerOrganizationId: string, platformOrganizationId: string, tx: TransactionClient): Promise<CrmCompany> {
  const company = await crmCompanyRepository.findById(companyId, tx);
  if (!company || company.organizationId !== platformOrganizationId) throw new NotFoundError("Company");
  if (company.convertedToOrganizationId !== customerOrganizationId) {
    throw new ValidationError("companyId does not match customerOrganizationId — the company must already be converted to exactly this customer organization.");
  }
  return company;
}

async function assertActiveCustomerOrganization(customerOrganizationId: string, tx: TransactionClient): Promise<Organization> {
  const org = await organizationRepository.findById(customerOrganizationId, tx);
  if (!org || org.status !== "ACTIVE") throw new ValidationError("customerOrganizationId does not reference an active organization.");
  if (org.isPlatform) throw new ValidationError("customerOrganizationId must be a real customer organization, not the platform organization.");
  return org;
}

const listProjectsSchema = z.object({
  status: z.enum(["DRAFT", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"]).optional(),
  customerOrganizationId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
});

export async function listProjects(rawInput: unknown): Promise<Project[]> {
  const input = parseOrThrow(listProjectsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.read");
  return withTenantContext(tenantScope, (tx) => projectRepository.listForOrganization(organizationId, input, tx));
}

export interface ProjectDetail {
  project: Project;
  milestones: Milestone[];
  tasks: ProjectTask[];
  dependencies: ProjectTaskDependency[];
  comments: ProjectComment[];
  attachments: ProjectAttachment[];
  approvals: ProjectApproval[];
  qaChecks: ProjectQaCheck[];
  progress: ProjectProgress;
  milestoneProgressById: Map<string, ProjectProgress>;
  completion: ProjectCompletionResult;
}

const projectIdSchema = z.object({ projectId: z.string().uuid() });

/** Composes every child collection a project's own overview/milestones/tasks/timeline/comments/QA/approvals tabs need, plus server-computed progress/completion — never trusted from the client. */
export async function getProjectDetail(rawInput: unknown): Promise<ProjectDetail> {
  const input = parseOrThrow(projectIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.read");

  return withTenantContext(tenantScope, async (tx) => {
    const project = await projectRepository.findById(input.projectId, tx);
    if (!project || project.organizationId !== organizationId) throw new NotFoundError("Project");

    const [milestones, tasks, dependencies, comments, attachments, approvals, qaChecks] = await Promise.all([
      milestoneRepository.listForProject(input.projectId, tx),
      projectTaskRepository.listForProject(input.projectId, tx),
      projectTaskDependencyRepository.listForProject(input.projectId, tx),
      projectCommentRepository.listForProject(input.projectId, tx),
      projectAttachmentRepository.listForProject(input.projectId, tx),
      projectApprovalRepository.listForProject(input.projectId, tx),
      projectQaCheckRepository.listForProject(input.projectId, tx),
    ]);

    const milestoneProgressById = new Map<string, ProjectProgress>();
    for (const milestone of milestones) {
      const milestoneTasks = tasks.filter((t) => t.milestoneId === milestone.id).map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId }));
      milestoneProgressById.set(milestone.id, calculateMilestoneProgress(milestoneTasks));
    }
    const progress = calculateProjectProgress(tasks.map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId })));
    const completion = evaluateProjectCompletionCriteria({
      tasks: tasks.map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId })),
      milestones: milestones.map((m) => ({ id: m.id, cancelledAt: m.cancelledAt })),
      milestoneProgressById,
      qaChecks: qaChecks.map((q) => ({ required: q.required, status: q.status })),
      approvals: approvals.map((a) => ({ status: a.status })),
    });

    return { project, milestones, tasks, dependencies, comments, attachments, approvals, qaChecks, progress, milestoneProgressById, completion };
  });
}

const createProjectSchema = z.object({
  customerOrganizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  ownerUserId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetEndDate: z.coerce.date().nullable().optional(),
});

/** Manual creation for an EXISTING customer (decision "Project creation — manual"). Never creates an `Organization`/`CrmCompany` implicitly — both must already exist and already be linked to each other. */
export async function createProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(createProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    await assertActiveCustomerOrganization(input.customerOrganizationId, tx);
    await resolveConsistentCompany(input.companyId, input.customerOrganizationId, organizationId, tx);
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    return projectRepository.create(
      {
        id: generateId(),
        organizationId,
        customerOrganizationId: input.customerOrganizationId,
        companyId: input.companyId,
        originatingOnboardingId: null,
        sourceServiceItemId: null,
        sourceTemplateId: null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        ownerUserId: input.ownerUserId ?? null,
        startDate: input.startDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await auditProject(context, "projects.created", organizationId, project, { source: "manual" });
  if (project.ownerUserId) {
    await events.emit<ProjectAssignedPayload>("projects.project_assigned", { projectId: project.id, organizationId, recipientUserId: project.ownerUserId, projectTitle: project.title });
  }
  return project;
}

const createFromOnboardingSchema = z.object({
  onboardingId: z.string().uuid(),
  /** Omit for a single "whole onboarding" project; provide to create one project scoped to a single sold service line — see project-management.md "Idempotency" for why these are two structurally distinct, mutually exclusive keys. */
  sourceServiceItemId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  ownerUserId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetEndDate: z.coerce.date().nullable().optional(),
});

/**
 * The onboarding -> project handoff (decisions #4/#5/#6). Eligibility:
 * the onboarding must be COMPLETED (delivery work is formally handed off
 * only once onboarding itself is done — an IN_PROGRESS onboarding has no
 * "handoff" to perform yet). Idempotent: locks the onboarding row for the
 * duration (serializes concurrent handoff attempts against the SAME
 * onboarding/service item — closes the "onboarding -> project double
 * creation" race in project-management.md "Concurrency"), then checks
 * for an already-active project under the exact same key and returns it
 * unchanged rather than erroring — a genuine idempotent-POST, not merely
 * a pre-check (the DB's own two partial unique indexes are the
 * structural backstop for a race this lock doesn't already prevent, e.g.
 * a lock bypassed by a direct DB write).
 */
export async function createProjectFromOnboarding(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(createFromOnboardingSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const { project, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    const onboarding = await crmClientOnboardingRepository.findByIdLocked(input.onboardingId, tx);
    if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");
    if (onboarding.status !== "COMPLETED") throw new ValidationError("Only a COMPLETED onboarding can be handed off to Project Management.");

    // Codex Security Engineer finding M1 — this validation MUST run
    // BEFORE the idempotency lookup below, not after: the lookup itself
    // is now ALSO scoped by `input.onboardingId` (defense in depth), but
    // ordering this check first is what stops a forged
    // onboardingId/sourceServiceItemId pair from ever reaching that
    // lookup with a service item that doesn't actually belong to the
    // (locked, COMPLETED-verified) onboarding in the first place.
    if (input.sourceServiceItemId) {
      const items = await crmClientOnboardingServiceItemRepository.listForOnboarding(input.onboardingId, tx);
      if (!items.some((item) => item.id === input.sourceServiceItemId)) throw new ValidationError("sourceServiceItemId does not belong to this onboarding.");
    }

    const existing = input.sourceServiceItemId ? await projectRepository.findActiveForServiceItem(input.onboardingId, input.sourceServiceItemId, tx) : await projectRepository.findActiveForWholeOnboarding(input.onboardingId, tx);
    if (existing) return { project: existing, wasCreated: false };

    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    const created = await projectRepository.create(
      {
        id: generateId(),
        organizationId,
        customerOrganizationId: onboarding.linkedOrganizationId,
        companyId: onboarding.companyId,
        originatingOnboardingId: onboarding.id,
        sourceServiceItemId: input.sourceServiceItemId ?? null,
        sourceTemplateId: null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        ownerUserId: input.ownerUserId ?? null,
        startDate: input.startDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
        createdByUserId: context.user!.id,
        status: "PLANNED",
      },
      tx,
    );
    return { project: created, wasCreated: true };
  });

  // Only genuinely new creations are audited/notified — the idempotent
  // "already exists, returned unchanged" path above is a silent no-op by
  // design (an audit event for a retry that changed nothing would be
  // noise, not a real fact about the system).
  if (wasCreated) {
    await auditProject(context, "projects.created", organizationId, project, { source: "onboarding", onboardingId: input.onboardingId, sourceServiceItemId: input.sourceServiceItemId ?? null });
    if (project.ownerUserId) {
      await events.emit<ProjectAssignedPayload>("projects.project_assigned", { projectId: project.id, organizationId, recipientUserId: project.ownerUserId, projectTitle: project.title });
    }
  }
  return project;
}

const instantiateFromTemplateSchema = z.object({
  templateId: z.string().uuid(),
  customerOrganizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
});

/**
 * Instantiates a `Project` from a `ProjectTemplate` by SNAPSHOTTING its
 * current structure — milestones, tasks, QA checks are copied as new,
 * independent rows. A later edit to the template never rewrites this
 * (or any other already-created) project; see project-management.md
 * "Templates." `relativeDueDays` becomes an absolute date only when
 * `startDate` is provided — otherwise every snapshotted date is left
 * `null` rather than fabricated from "today."
 */
export async function createProjectFromTemplate(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(instantiateFromTemplateSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const template = await projectTemplateRepository.findById(input.templateId, tx);
    if (!template || template.organizationId !== organizationId) throw new NotFoundError("Project template");
    if (template.status !== "ACTIVE") throw new ValidationError("Only an ACTIVE template can be instantiated.");

    await assertActiveCustomerOrganization(input.customerOrganizationId, tx);
    await resolveConsistentCompany(input.companyId, input.customerOrganizationId, organizationId, tx);
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    const created = await projectRepository.create(
      {
        id: generateId(),
        organizationId,
        customerOrganizationId: input.customerOrganizationId,
        companyId: input.companyId,
        originatingOnboardingId: null,
        sourceServiceItemId: null,
        sourceTemplateId: template.id,
        title: input.title ?? template.name,
        description: input.description ?? template.description,
        priority: "MEDIUM",
        ownerUserId: input.ownerUserId ?? null,
        startDate: input.startDate ?? null,
        targetEndDate: null,
        createdByUserId: context.user!.id,
        status: "PLANNED",
      },
      tx,
    );

    const [templateMilestones, templateTasks, templateQaChecks] = await Promise.all([
      projectTemplateMilestoneRepository.listForTemplate(template.id, tx),
      projectTemplateTaskRepository.listForTemplate(template.id, tx),
      projectTemplateQaCheckRepository.listForTemplate(template.id, tx),
    ]);

    const milestoneIdByTemplateMilestoneId = new Map<string, string>();
    for (const tm of templateMilestones) {
      const newId = generateId();
      milestoneIdByTemplateMilestoneId.set(tm.id, newId);
      await milestoneRepository.create(
        {
          id: newId,
          organizationId,
          projectId: created.id,
          title: tm.title,
          description: tm.description,
          sortOrder: tm.sortOrder,
          targetDate: input.startDate && tm.relativeDueDays !== null ? addDays(input.startDate, tm.relativeDueDays) : null,
          customerVisible: tm.customerVisible,
          createdByUserId: context.user!.id,
        },
        tx,
      );
    }

    for (const tt of templateTasks) {
      await projectTaskRepository.create(
        {
          id: generateId(),
          organizationId,
          projectId: created.id,
          milestoneId: tt.templateMilestoneId ? (milestoneIdByTemplateMilestoneId.get(tt.templateMilestoneId) ?? null) : null,
          parentTaskId: null,
          title: tt.title,
          description: tt.description,
          priority: tt.priority,
          assignedToUserId: null,
          dueDate: input.startDate && tt.relativeDueDays !== null ? addDays(input.startDate, tt.relativeDueDays) : null,
          sortOrder: tt.sortOrder,
          customerVisible: tt.customerVisible,
          createdByUserId: context.user!.id,
        },
        tx,
      );
    }

    for (const tq of templateQaChecks) {
      await projectQaCheckRepository.create({ id: generateId(), organizationId, projectId: created.id, taskId: null, milestoneId: null, title: tq.title, required: tq.required }, tx);
    }

    return created;
  });

  await auditProject(context, "projects.template_instantiated", organizationId, project, { templateId: input.templateId });
  if (project.ownerUserId) {
    await events.emit<ProjectAssignedPayload>("projects.project_assigned", { projectId: project.id, organizationId, recipientUserId: project.ownerUserId, projectTitle: project.title });
  }
  return project;
}

const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetEndDate: z.coerce.date().nullable().optional(),
});

export async function updateProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(updateProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const { updated, ownerChanged } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findById(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (input.ownerUserId !== undefined && input.ownerUserId !== null) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    const { projectId, ...data } = input;
    const updated = await projectRepository.update(projectId, data, tx);
    return { updated, ownerChanged: input.ownerUserId !== undefined && input.ownerUserId !== existing.ownerUserId };
  });

  if (ownerChanged) {
    await auditProject(context, "projects.owner_changed", organizationId, updated, { newOwnerUserId: updated.ownerUserId });
    if (updated.ownerUserId) {
      await events.emit<ProjectAssignedPayload>("projects.project_assigned", { projectId: updated.id, organizationId, recipientUserId: updated.ownerUserId, projectTitle: updated.title });
    }
  }
  return updated;
}

const transitionProjectSchema = z.object({ projectId: z.string().uuid(), status: z.enum(["PLANNED", "ACTIVE", "ON_HOLD"]) });

/** Ordinary, non-terminal transitions only (and the COMPLETED -> ACTIVE reopen). COMPLETED/CANCELLED/ARCHIVED always go through their own dedicated functions below, each with its own required inputs (reason, completion criteria) and its own distinct audit action. */
export async function transitionProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(transitionProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findByIdLocked(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (!canTransitionProject(existing.status as ProjectStatus, input.status as ProjectStatus)) {
      throw new ValidationError(`Cannot transition a project from ${existing.status} to ${input.status}.`);
    }
    const updated = await projectRepository.transitionStatus(input.projectId, [existing.status], input.status, tx);
    if (!updated) throw new ConflictError("This project's status just changed. Reload and try again.");
    return updated;
  });

  await auditProject(context, "projects.lifecycle_transitioned", organizationId, project, { to: input.status });
  return project;
}

/** The COMPLETED -> ACTIVE reopen, kept distinct from `transitionProject()` because it must clear the prior completion facts (`projectRepository.reopen()`), not merely flip `status`. */
export async function reopenProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(projectIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findByIdLocked(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (!canTransitionProject(existing.status as ProjectStatus, "ACTIVE")) throw new ValidationError(`Cannot reopen a project from ${existing.status}.`);
    const updated = await projectRepository.reopen(input.projectId, tx);
    if (!updated) throw new ConflictError("This project's status just changed. Reload and try again.");
    return updated;
  });

  await auditProject(context, "projects.lifecycle_transitioned", organizationId, project, { to: "ACTIVE", reopened: true });
  return project;
}

const cancelProjectSchema = z.object({ projectId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function cancelProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(cancelProjectSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findByIdLocked(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (!canTransitionProject(existing.status as ProjectStatus, "CANCELLED")) throw new ValidationError(`Cannot cancel a project from ${existing.status}.`);
    const updated = await projectRepository.cancel(input.projectId, [existing.status], { cancelledAt: new Date(), cancelledByUserId: context.user!.id, cancelledReason: input.reason }, tx);
    if (!updated) throw new ConflictError("This project's status just changed. Reload and try again.");
    return updated;
  });

  await auditProject(context, "projects.lifecycle_transitioned", organizationId, project, { to: "CANCELLED", reason: input.reason });
  return project;
}

export async function archiveProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(projectIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findByIdLocked(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (!canTransitionProject(existing.status as ProjectStatus, "ARCHIVED")) throw new ValidationError(`Cannot archive a project from ${existing.status}.`);
    const updated = await projectRepository.archive(input.projectId, [existing.status], tx);
    if (!updated) throw new ConflictError("This project's status just changed. Reload and try again.");
    return updated;
  });

  await auditProject(context, "projects.lifecycle_transitioned", organizationId, project, { to: "ARCHIVED" });
  return project;
}

/** Reads every input `evaluateProjectCompletionCriteria()` needs, inside the SAME locked transaction the CAS write happens in — the same "lock before read, not just before write" discipline `completeOnboarding()` documents, so nothing can commit a criteria-affecting child mutation (a task completion, a QA result, an approval decision) between the read and the write. */
async function readCompletionInputs(projectId: string, tx: TransactionClient) {
  const [tasks, milestones, qaChecks, approvals] = await Promise.all([
    projectTaskRepository.listForProject(projectId, tx),
    milestoneRepository.listForProject(projectId, tx),
    projectQaCheckRepository.listForProject(projectId, tx),
    projectApprovalRepository.listForProject(projectId, tx),
  ]);
  const milestoneProgressById = new Map<string, ProjectProgress>();
  for (const milestone of milestones) {
    const milestoneTasks = tasks.filter((t) => t.milestoneId === milestone.id).map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId }));
    milestoneProgressById.set(milestone.id, calculateMilestoneProgress(milestoneTasks));
  }
  return evaluateProjectCompletionCriteria({
    tasks: tasks.map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId })),
    milestones: milestones.map((m) => ({ id: m.id, cancelledAt: m.cancelledAt })),
    milestoneProgressById,
    qaChecks: qaChecks.map((q) => ({ required: q.required, status: q.status })),
    approvals: approvals.map((a) => ({ status: a.status })),
  });
}

async function notifyProjectCompleted(project: Project, organizationId: string): Promise<void> {
  if (!project.ownerUserId) return;
  await events.emit<ProjectCompletedPayload>("projects.project_completed", { projectId: project.id, organizationId, recipientUserId: project.ownerUserId, projectTitle: project.title });
}

/** Ordinary, criteria-met completion — refuses outright (never silently fabricates readiness) if any required gate is unmet. Use `completeProjectOverride()` for the privileged bypass. */
export async function completeProject(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(projectIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findByIdLocked(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (!canTransitionProject(existing.status as ProjectStatus, "COMPLETED")) throw new ValidationError(`Cannot complete a project from ${existing.status}.`);

    const criteria = await readCompletionInputs(input.projectId, tx);
    if (!criteria.met) {
      throw new ValidationError(`This project cannot be completed yet — unmet: ${criteria.unmet.join(", ")}. Use the override path (projects.approve) if this is genuinely intentional.`);
    }

    const updated = await projectRepository.complete(input.projectId, [existing.status], { completedAt: new Date(), completedByUserId: context.user!.id, completionOverride: false, completionOverrideReason: null }, tx);
    if (!updated) throw new ConflictError("This project's status just changed. Reload and try again.");
    return updated;
  });

  await auditProject(context, "projects.lifecycle_transitioned", organizationId, project, { to: "COMPLETED" });
  await notifyProjectCompleted(project, organizationId);
  return project;
}

const completeOverrideSchema = z.object({ projectId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

/**
 * The privileged override — forces completion despite incomplete
 * required work. Requires `delivery_projects.approve`, a SEPARATE permission from
 * the ordinary `delivery_projects.manage` every other mutation in this file uses
 * (decision "Project completion — override"), a reason is required, and
 * it is always audited under a DISTINCT action
 * (`projects.completed_override`) so it is never confused with a
 * genuine criteria-met completion in the audit log.
 */
export async function completeProjectOverride(rawInput: unknown): Promise<Project> {
  const input = parseOrThrow(completeOverrideSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.approve");

  const project = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectRepository.findByIdLocked(input.projectId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project");
    if (!canTransitionProject(existing.status as ProjectStatus, "COMPLETED")) throw new ValidationError(`Cannot complete a project from ${existing.status}.`);
    const updated = await projectRepository.complete(input.projectId, [existing.status], { completedAt: new Date(), completedByUserId: context.user!.id, completionOverride: true, completionOverrideReason: input.reason }, tx);
    if (!updated) throw new ConflictError("This project's status just changed. Reload and try again.");
    return updated;
  });

  await auditProject(context, "projects.completed_override", organizationId, project, { reason: input.reason });
  await notifyProjectCompleted(project, organizationId);
  return project;
}

export type { ProjectAssignedPayload, ProjectCompletedPayload };
