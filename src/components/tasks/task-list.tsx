"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";
import { completeGlobalTaskAction, reopenGlobalTaskAction, assignGlobalTaskAction, changeGlobalTaskDueDateAction } from "@/app/(protected)/admin/tasks/actions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { projectPriorityVariant } from "@/components/projects/project-status";
import { taskStatusVariant, taskSourceVariant, TASK_SOURCE_LABELS } from "@/lib/tasks/display";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { TaskItem } from "@/lib/tasks/types";
import type { User } from "@/generated/prisma/client";

/**
 * `/admin/tasks` row list (Build 28 — Roadmap Module 22). Quick actions
 * (complete/reopen/assign/change due date) are shown ONLY when the
 * row's own `capabilities` flag says so — those flags are UX sugar, the
 * server independently re-authorizes and re-validates every action
 * regardless (see `docs/architecture/task-management.md` "Quick
 * actions"). Cancellation isn't a quick action here; it stays on each
 * task's own source detail page, same as the frozen capability shape.
 */
export function TaskList({ tasks, assignableUsers }: { tasks: TaskItem[]; assignableUsers: User[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Tasks table, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Task</th>
            <th className="px-4 py-2.5">Source</th>
            <th className="px-4 py-2.5">Context</th>
            <th className="px-4 py-2.5">Assignee</th>
            <th className="px-4 py-2.5">Priority</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Due</th>
            <th className="px-4 py-2.5">
              <span className="sr-only">Quick actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <TaskRow key={task.key} task={task} assignableUsers={assignableUsers} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task, assignableUsers }: { task: TaskItem; assignableUsers: User[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function runAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  const contextLabel = task.context.companyName ?? task.context.projectTitle ?? null;

  return (
    <tr className="border-b border-border align-top last:border-0 hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link href={task.href} className="font-medium hover:underline">
          {task.title}
        </Link>
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge status={taskSourceVariant(task.sourceType)}>{TASK_SOURCE_LABELS[task.sourceType]}</StatusBadge>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">{contextLabel ?? "—"}</td>
      <td className="px-4 py-2.5">
        {task.capabilities.canAssign ? (
          <select
            defaultValue={task.assigneeUserId ?? ""}
            disabled={pending}
            aria-label={`Reassign "${task.title}"`}
            onChange={(e) => runAction(() => assignGlobalTaskAction({ key: task.key, assignedToUserId: e.target.value || null }))}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">Unassigned</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground">{task.assigneeName ?? "Unassigned"}</span>
        )}
      </td>
      <td className="px-4 py-2.5">{task.priority ? <StatusBadge status={projectPriorityVariant(task.priority)}>{task.priority}</StatusBadge> : <span className="text-xs text-muted-foreground">Not set</span>}</td>
      <td className="px-4 py-2.5">
        <StatusBadge status={taskStatusVariant(task.status)}>{task.status.replace("_", " ")}</StatusBadge>
      </td>
      <td className="px-4 py-2.5">
        {task.capabilities.canChangeDueDate ? (
          <input
            type="date"
            disabled={pending}
            aria-label={`Change due date for "${task.title}"`}
            defaultValue={task.dueAt ? task.dueAt.toISOString().slice(0, 10) : ""}
            onChange={(e) => runAction(() => changeGlobalTaskDueDateAction({ key: task.key, dueAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null }))}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
        ) : task.dueAt ? (
          <span className={task.isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}>
            {formatInTimeZone(task.dueAt, "UTC", { hour: undefined, minute: undefined })}
            {task.isOverdue ? " · Overdue" : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">No due date</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {task.capabilities.canComplete ? (
            <Button size="icon" variant="outline" disabled={pending} onClick={() => runAction(() => completeGlobalTaskAction({ key: task.key }))} aria-label={`Mark "${task.title}" complete`}>
              <Check className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          {task.capabilities.canReopen ? (
            <Button size="icon" variant="ghost" disabled={pending} onClick={() => runAction(() => reopenGlobalTaskAction({ key: task.key }))} aria-label={`Reopen "${task.title}"`}>
              <RotateCcw className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
