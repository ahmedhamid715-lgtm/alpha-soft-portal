"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateInternalTaskAction, completeInternalTaskAction, reopenInternalTaskAction, cancelInternalTaskAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { projectPriorityVariant } from "@/components/projects/project-status";
import { taskStatusVariant } from "@/lib/tasks/display";
import { normalizeTaskStatus } from "@/lib/tasks/status";
import type { InternalTask, User } from "@/generated/prisma/client";

export function InternalTaskDetail({ task, canManage, assignableUsers }: { task: InternalTask; canManage: boolean; assignableUsers: User[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const priorityId = useId();
  const assigneeId = useId();
  const dueAtId = useId();
  const reasonId = useId();

  const status = normalizeTaskStatus("STANDALONE_TASK", task.status);
  const notTerminal = task.status !== "COMPLETED" && task.status !== "CANCELLED";

  function runAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  function handleSave(formData: FormData) {
    const title = formData.get("title");
    const description = formData.get("description");
    const priority = formData.get("priority");
    const assignedToUserId = formData.get("assignedToUserId");
    const dueAt = formData.get("dueAt");
    runAction(() =>
      updateInternalTaskAction({
        taskId: task.id,
        title: typeof title === "string" && title.length > 0 ? title : undefined,
        description: typeof description === "string" ? (description.length > 0 ? description : null) : undefined,
        priority: typeof priority === "string" && priority.length > 0 ? priority : undefined,
        assignedToUserId: typeof assignedToUserId === "string" ? (assignedToUserId.length > 0 ? assignedToUserId : null) : undefined,
        dueAt: typeof dueAt === "string" ? (dueAt.length > 0 ? `${dueAt}T00:00:00.000Z` : null) : undefined,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StatusBadge status={taskStatusVariant(status)}>{status.replace("_", " ")}</StatusBadge>
        <StatusBadge status={projectPriorityVariant(task.priority)}>{task.priority}</StatusBadge>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <form action={canManage ? handleSave : undefined} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId}>Title</Label>
              <Input id={titleId} name="title" defaultValue={task.title} maxLength={200} disabled={!canManage || pending} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea id={descriptionId} name="description" defaultValue={task.description ?? ""} maxLength={2000} rows={3} disabled={!canManage || pending} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={priorityId}>Priority</Label>
                <select id={priorityId} name="priority" defaultValue={task.priority} disabled={!canManage || pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={dueAtId}>Due date</Label>
                <Input id={dueAtId} name="dueAt" type="date" defaultValue={task.dueAt ? task.dueAt.toISOString().slice(0, 10) : ""} disabled={!canManage || pending} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={assigneeId}>Assignee</Label>
              <select id={assigneeId} name="assignedToUserId" defaultValue={task.assignedToUserId ?? ""} disabled={!canManage || pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Unassigned</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            {canManage ? (
              <Button type="submit" disabled={pending} className="w-fit">
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Save changes
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {notTerminal ? (
            <Button variant="outline" disabled={pending} onClick={() => runAction(() => completeInternalTaskAction({ taskId: task.id }))}>
              Mark complete
            </Button>
          ) : null}
          {task.status === "COMPLETED" ? (
            <Button variant="outline" disabled={pending} onClick={() => runAction(() => reopenInternalTaskAction({ taskId: task.id }))}>
              Reopen
            </Button>
          ) : null}
          {notTerminal ? (
            <Button variant="ghost" disabled={pending} onClick={() => setShowCancel((v) => !v)}>
              Cancel task
            </Button>
          ) : null}
        </div>
      ) : null}

      {showCancel ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor={reasonId}>Cancellation reason</Label>
            <Input id={reasonId} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={1000} required />
            <Button
              variant="destructive"
              disabled={pending || cancelReason.trim().length === 0}
              onClick={() =>
                runAction(async () => {
                  const result = await cancelInternalTaskAction({ taskId: task.id, reason: cancelReason });
                  if (!result.error) setShowCancel(false);
                  return result;
                })
              }
              className="w-fit"
            >
              Confirm cancellation
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
