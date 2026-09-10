import "server-only";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope } from "./project-shared";
import { projectRepository } from "@/server/repositories/project-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { calculateProjectProgress, type ProjectProgress } from "@/lib/projects/progress";
import type { ProjectHealthInput } from "@/lib/crm/client-success";
import type { ProjectStatus, ProjectPriority } from "@/generated/prisma/client";

/**
 * The ONE safe read Customer 360 (Build 24) is allowed to compose
 * Project Management data through — see project-management.md "Customer
 * 360 integration": "Do NOT create Project queries directly inside
 * Customer 360. Source domain owns reads." A deliberately narrow summary
 * shape (no tasks/milestones/comments/attachments — a staff member who
 * wants that detail follows through to the real `/admin/projects/[id]`
 * page, which this summary's own `id` field links to).
 */
export interface Customer360ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  progress: ProjectProgress;
  startDate: Date | null;
  targetEndDate: Date | null;
  ownerUserId: string | null;
}

export async function listProjectsForCustomer360(customerOrganizationId: string): Promise<Customer360ProjectSummary[]> {
  const { tenantScope } = await resolveProjectScope("delivery_projects.read");

  return withTenantContext(tenantScope, async (tx) => {
    const projects = await projectRepository.listForCustomerOrganization(customerOrganizationId, tx);
    if (projects.length === 0) return [];
    const tasks = await projectTaskRepository.listForProjects(projects.map((p) => p.id), tx);

    return projects.map((project) => {
      const projectTasks = tasks.filter((t) => t.projectId === project.id).map((t) => ({ id: t.id, status: t.status, parentTaskId: t.parentTaskId }));
      return {
        id: project.id,
        title: project.title,
        status: project.status,
        priority: project.priority,
        progress: calculateProjectProgress(projectTasks),
        startDate: project.startDate,
        targetEndDate: project.targetEndDate,
        ownerUserId: project.ownerUserId,
      };
    });
  });
}

const APPROACHING_TARGET_DATE_WINDOW_DAYS = 14;

/**
 * The real facts behind Client Success's Project Health component (Build
 * 25 integration — see docs/architecture/project-management.md "Client
 * Success integration" for the frozen formula this feeds). Aggregates
 * across every `ACTIVE`/`ON_HOLD` project for this customer — see
 * `ProjectHealthInput`'s own doc comment for why those two statuses
 * specifically. The caller (`crm-client-success-health-service.ts`) is
 * responsible for the NOT_MEASURABLE authorization gate (no
 * `delivery_projects.read`) — this function assumes it's already allowed
 * to read, the same division of responsibility `resolvePaymentHealth()`
 * already establishes for Payment Health.
 */
export async function getProjectHealthInputForCustomer360(customerOrganizationId: string): Promise<ProjectHealthInput> {
  const { tenantScope } = await resolveProjectScope("delivery_projects.read");

  return withTenantContext(tenantScope, async (tx) => {
    const allProjects = await projectRepository.listForCustomerOrganization(customerOrganizationId, tx);
    const relevantProjects = allProjects.filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD");
    if (relevantProjects.length === 0) {
      return { activeProjectCount: 0, onHoldProjectCount: 0, overdueRequiredTaskCount: 0, blockedRequiredTaskCount: 0, pastTargetDateProjectCount: 0, approachingTargetDateProjectCount: 0, failedRequiredQaCount: 0 };
    }

    const relevantProjectIds = relevantProjects.map((p) => p.id);
    const [tasks, qaChecks] = await Promise.all([projectTaskRepository.listForProjects(relevantProjectIds, tx), projectQaCheckRepository.listForProjects(relevantProjectIds, tx)]);

    const now = Date.now();
    const approachingCutoff = now + APPROACHING_TARGET_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const rootTasks = tasks.filter((t) => t.parentTaskId === null);
    const overdueRequiredTaskCount = rootTasks.filter((t) => t.dueDate && t.dueDate.getTime() < now && t.status !== "DONE" && t.status !== "CANCELLED").length;
    const blockedRequiredTaskCount = rootTasks.filter((t) => t.status === "BLOCKED").length;
    const pastTargetDateProjectCount = relevantProjects.filter((p) => p.targetEndDate && p.targetEndDate.getTime() < now).length;
    const approachingTargetDateProjectCount = relevantProjects.filter((p) => p.targetEndDate && p.targetEndDate.getTime() >= now && p.targetEndDate.getTime() <= approachingCutoff).length;
    const failedRequiredQaCount = qaChecks.filter((q) => q.required && q.status === "FAILED").length;

    return {
      activeProjectCount: relevantProjects.length,
      onHoldProjectCount: relevantProjects.filter((p) => p.status === "ON_HOLD").length,
      overdueRequiredTaskCount,
      blockedRequiredTaskCount,
      pastTargetDateProjectCount,
      approachingTargetDateProjectCount,
      failedRequiredQaCount,
    };
  });
}
