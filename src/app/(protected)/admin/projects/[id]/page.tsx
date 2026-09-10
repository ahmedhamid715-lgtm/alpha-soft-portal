import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getProjectDetail } from "@/server/services/project-service";
import { getCompany } from "@/server/services/crm-company-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { NotFoundError, toAppError } from "@/lib/errors/app-error";
import { projectStatusVariant, projectPriorityVariant } from "@/components/projects/project-status";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { ProjectProgressDisplay } from "@/components/projects/project-progress-display";
import { OverviewTab } from "./overview-tab";
import { MilestonesTab } from "./milestones-tab";
import { TasksTab } from "./tasks-tab";
import { CommentsTab } from "./comments-tab";
import { QaTab } from "./qa-tab";
import { ApprovalsTab } from "./approvals-tab";

export const metadata: Metadata = { title: "Project" };

/**
 * One project's full operational detail (Build 27 — Roadmap Module 21):
 * overview/team/customer context, milestones, tasks, comments, QA,
 * approvals. `delivery_projects.read` is the floor; every mutation form
 * below is additionally gated by `canManage`/`canQa`/`canApprove`, each
 * independently re-checked server-side by its own Server Action ->
 * service call regardless of what this page chooses to render.
 */
export default async function ProjectDetailPage({ params }: PageProps<"/admin/projects/[id]">) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_projects.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Project" breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: "Project" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_projects.read permission." />
      </div>
    );
  }

  let detail;
  try {
    detail = await getProjectDetail({ projectId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND" || error instanceof NotFoundError) notFound();
    throw error;
  }

  const { project, milestones, tasks, dependencies, comments, attachments, approvals, qaChecks, progress, milestoneProgressById, completion } = detail;
  const [company, assignableUsers] = await Promise.all([getCompany({ companyId: project.companyId }), listAssignableUsers()]);

  const canManage = context.permissions.has("delivery_projects.manage");
  const canQa = context.permissions.has("delivery_projects.qa");
  const canApprove = context.permissions.has("delivery_projects.approve");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.title}
        description={`Customer: ${company.name}`}
        breadcrumbs={[{ label: "Projects", href: "/admin/projects" }, { label: project.title }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={projectPriorityVariant(project.priority)}>{project.priority}</StatusBadge>
            <StatusBadge status={projectStatusVariant(project.status)}>{project.status.replace("_", " ")}</StatusBadge>
          </div>
        }
      />

      <ProjectProgressDisplay progress={progress} label="Overall progress" />

      <ProjectTabs
        tabs={[
          { value: "overview", label: "Overview", content: <OverviewTab project={project} company={company} assignableUsers={assignableUsers} completion={completion} attachments={attachments} canManage={canManage} /> },
          { value: "milestones", label: "Milestones", content: <MilestonesTab projectId={project.id} milestones={milestones} milestoneProgressById={milestoneProgressById} canManage={canManage} /> },
          { value: "tasks", label: "Tasks", content: <TasksTab projectId={project.id} tasks={tasks} milestones={milestones} dependencies={dependencies} assignableUsers={assignableUsers} canManage={canManage} /> },
          { value: "comments", label: "Comments", content: <CommentsTab projectId={project.id} tasks={tasks} comments={comments} canManage={canManage} /> },
          { value: "qa", label: "QA", content: <QaTab projectId={project.id} tasks={tasks} milestones={milestones} qaChecks={qaChecks} canManage={canManage} canQa={canQa} /> },
          { value: "approvals", label: "Approvals", content: <ApprovalsTab projectId={project.id} milestones={milestones} approvals={approvals} currentUserId={context.user!.id} canManage={canManage} canApprove={canApprove} /> },
        ]}
      />
    </div>
  );
}
