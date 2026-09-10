import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { CreateInternalTaskForm } from "./create-internal-task-form";

export const metadata: Metadata = { title: "New internal task" };

/** Standalone `InternalTask` creation (Build 28 — Roadmap Module 22) — the ONE genuinely standalone task type this module owns, for work with no CRM/Project/Onboarding home. `task_management.manage`. */
export default async function NewInternalTaskPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("task_management.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New internal task" breadcrumbs={[{ label: "Tasks", href: "/admin/tasks" }, { label: "New" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the task_management.manage permission." />
      </div>
    );
  }

  const assignableUsers = await listAssignableUsers();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="New internal task"
        description="For internal admin work with no home in a CRM task, delivery project, or onboarding checklist — not a replacement for any of those."
        breadcrumbs={[{ label: "Tasks", href: "/admin/tasks" }, { label: "New" }]}
      />
      <CreateInternalTaskForm assignableUsers={assignableUsers} />
    </div>
  );
}
