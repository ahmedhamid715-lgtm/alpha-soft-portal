import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getInternalTask } from "@/server/services/tasks/internal-task-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { NotFoundError } from "@/lib/errors/app-error";
import { InternalTaskDetail } from "./internal-task-detail";

export const metadata: Metadata = { title: "Task" };

/** Standalone `InternalTask` detail/edit (Build 28 — Roadmap Module 22) — every OTHER task source's detail lives on its OWN authoritative page; this page exists only for the one genuinely standalone task type. `task_management.read`, edits require `task_management.manage`. */
export default async function InternalTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("task_management.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Task" breadcrumbs={[{ label: "Tasks", href: "/admin/tasks" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the task_management.read permission." />
      </div>
    );
  }

  let task;
  try {
    task = await getInternalTask({ taskId: id });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canManage = context.permissions.has("task_management.manage");
  const assignableUsers = canManage ? await listAssignableUsers() : [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={task.title} breadcrumbs={[{ label: "Tasks", href: "/admin/tasks" }, { label: task.title }]} />
      <InternalTaskDetail task={task} canManage={canManage} assignableUsers={assignableUsers} />
    </div>
  );
}
