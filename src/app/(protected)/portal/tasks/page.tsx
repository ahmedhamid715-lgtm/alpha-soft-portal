import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { listMyTasks } from "@/server/services/portal/portal-project-service";
import { projectTaskStatusVariant, projectPriorityVariant } from "@/components/projects/project-status";
import { formatInTimeZone } from "@/lib/utils/datetime";

export const metadata: Metadata = { title: "Tasks" };

/**
 * The Customer Portal's real "My Tasks" (Build 28 — Roadmap Module 22),
 * replacing Build 26's honest "not available yet" placeholder — see
 * `portal-project-service.ts`'s `listMyTasks()` for the exact
 * customer-safe visibility boundary (customer-visible delivery project
 * tasks only; no CRM tasks, no internal standalone tasks, no onboarding
 * items; visibility is never treated as assignment).
 */
export default async function PortalTasksPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Tasks" />;

  const tasks = await listMyTasks({ organizationId: guard.organizationId });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Tasks" description="Work items visible to you across your active projects." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Tasks" }]} />

      {tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks to show" description="Task-level detail will appear here as your projects progress." />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <Link key={task.id} href={`/portal/projects/${task.projectId}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{task.title}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={projectPriorityVariant(task.priority)}>{task.priority}</StatusBadge>
                      <StatusBadge status={projectTaskStatusVariant(task.status)}>{task.status.replace("_", " ")}</StatusBadge>
                    </div>
                  </div>
                  {task.description ? <p className="text-sm text-muted-foreground">{task.description}</p> : null}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{task.projectTitle}</span>
                    <span>{task.dueDate ? `Due ${formatInTimeZone(task.dueDate, "UTC", { hour: undefined, minute: undefined })}` : "No due date"}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
