"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ListChecks } from "lucide-react";
import { completeTaskAction, cancelTaskAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CrmTask } from "@/generated/prisma/client";

export function CrmTaskList({ tasks, canManage }: { tasks: CrmTask[]; canManage: boolean }) {
  if (tasks.length === 0) {
    return <EmptyState icon={ListChecks} title="No tasks yet" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} canManage={canManage} />
      ))}
    </div>
  );
}

function TaskRow({ task, canManage }: { task: CrmTask; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleComplete() {
    startTransition(async () => {
      await completeTaskAction({ taskId: task.id });
      router.refresh();
    });
  }

  function handleCancel() {
    startTransition(async () => {
      await cancelTaskAction({ taskId: task.id });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{task.title}</span>
          <span className="text-xs text-muted-foreground">{task.dueAt ? `Due ${formatInTimeZone(task.dueAt, "UTC")}` : "No due date"}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status === "COMPLETED" ? "success" : task.status === "CANCELLED" ? "neutral" : "warning"}>{task.status}</StatusBadge>
          {canManage && task.status === "OPEN" ? (
            <>
              <Button size="icon" variant="outline" disabled={pending} onClick={handleComplete} aria-label="Complete task">
                <Check className="size-4" aria-hidden="true" />
              </Button>
              <Button size="icon" variant="ghost" disabled={pending} onClick={handleCancel} aria-label="Cancel task">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
