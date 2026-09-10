"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createTaskAction, transitionTaskAction, completeTaskAction, cancelTaskAction, addTaskDependencyAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { projectTaskStatusVariant, projectPriorityVariant } from "@/components/projects/project-status";
import type { Milestone, ProjectTask, ProjectTaskDependency, User } from "@/generated/prisma/client";

const initialState: ProjectActionState = {};

export function TasksTab({
  projectId,
  tasks,
  milestones,
  dependencies,
  assignableUsers,
  canManage,
}: {
  projectId: string;
  tasks: ProjectTask[];
  milestones: Milestone[];
  dependencies: ProjectTaskDependency[];
  assignableUsers: User[];
  canManage: boolean;
}) {
  const rootTasks = tasks.filter((t) => t.parentTaskId === null);
  const subtasksByParent = new Map<string, ProjectTask[]>();
  for (const t of tasks) {
    if (t.parentTaskId) subtasksByParent.set(t.parentTaskId, [...(subtasksByParent.get(t.parentTaskId) ?? []), t]);
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="flex flex-col gap-4">
      {rootTasks.length === 0 ? (
        <EmptyState title="No tasks yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {rootTasks.map((task) => (
            <div key={task.id} className="flex flex-col gap-2">
              <TaskCard projectId={projectId} task={task} dependencies={dependencies.filter((d) => d.taskId === task.id)} taskById={taskById} canManage={canManage} />
              {(subtasksByParent.get(task.id) ?? []).map((subtask) => (
                <div key={subtask.id} className="ml-8">
                  <TaskCard projectId={projectId} task={subtask} dependencies={dependencies.filter((d) => d.taskId === subtask.id)} taskById={taskById} canManage={canManage} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <>
          <AddTaskForm projectId={projectId} milestones={milestones} rootTasks={rootTasks} assignableUsers={assignableUsers} />
          {tasks.length >= 2 ? <AddDependencyForm projectId={projectId} tasks={tasks} /> : null}
        </>
      ) : null}
    </div>
  );
}

function TaskCard({ projectId, task, dependencies, taskById, canManage }: { projectId: string; task: ProjectTask; dependencies: ProjectTaskDependency[]; taskById: Map<string, ProjectTask>; canManage: boolean }) {
  const [transitionState, transitionAction, transitionPending] = useActionState(transitionTaskAction, initialState);
  const [completeState, completeAction, completePending] = useActionState(completeTaskAction, initialState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelTaskAction, initialState);
  const reasonId = useId();
  const error = transitionState.error ?? completeState.error ?? cancelState.error;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{task.title}</span>
          <div className="flex items-center gap-2">
            <StatusBadge status={projectPriorityVariant(task.priority)}>{task.priority}</StatusBadge>
            <StatusBadge status={projectTaskStatusVariant(task.status)}>{task.status.replace("_", " ")}</StatusBadge>
          </div>
        </div>
        {task.description ? <p className="text-sm text-muted-foreground">{task.description}</p> : null}
        {dependencies.length > 0 ? (
          <p className="text-xs text-muted-foreground">Depends on: {dependencies.map((d) => taskById.get(d.dependsOnTaskId)?.title ?? d.dependsOnTaskId).join(", ")}</p>
        ) : null}
        <span className="text-xs text-muted-foreground">Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}</span>

        {canManage && task.status !== "DONE" && task.status !== "CANCELLED" ? (
          <div className="flex flex-wrap gap-2">
            {(["TODO", "IN_PROGRESS", "BLOCKED"] as const)
              .filter((s) => s !== task.status)
              .map((s) => (
                <form key={s} action={transitionAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="status" value={s} />
                  <Button type="submit" variant="outline" size="sm" disabled={transitionPending}>
                    {s.replace("_", " ")}
                  </Button>
                </form>
              ))}
            <form action={completeAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="projectId" value={projectId} />
              <Button type="submit" size="sm" disabled={completePending}>
                Complete
              </Button>
            </form>
          </div>
        ) : null}

        {canManage && task.status !== "CANCELLED" ? (
          <form action={cancelAction} className="flex items-end gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="projectId" value={projectId} />
            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor={`${reasonId}-${task.id}`}>Cancellation reason</Label>
              <Input id={`${reasonId}-${task.id}`} name="reason" maxLength={1000} required />
            </div>
            <Button type="submit" variant="destructive" size="sm" disabled={cancelPending}>
              Cancel
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddTaskForm({ projectId, milestones, rootTasks, assignableUsers }: { projectId: string; milestones: Milestone[]; rootTasks: ProjectTask[]; assignableUsers: User[] }) {
  const [state, formAction, pending] = useActionState(createTaskAction, initialState);
  const titleId = useId();
  const descriptionId = useId();
  const milestoneId = useId();
  const parentTaskId = useId();
  const priorityId = useId();
  const assigneeId = useId();
  const dueDateId = useId();
  const customerVisibleId = useId();
  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} name="title" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={5000} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={milestoneId}>Milestone</Label>
              <select id={milestoneId} name="milestoneId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">None</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={parentTaskId}>Parent task (subtask)</Label>
              <select id={parentTaskId} name="parentTaskId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">None — root task</option>
                {rootTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={priorityId}>Priority</Label>
              <select id={priorityId} name="priority" defaultValue="MEDIUM" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={assigneeId}>Assignee</Label>
              <select id={assigneeId} name="assignedToUserId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Unassigned</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={dueDateId}>Due date</Label>
              <Input id={dueDateId} name="dueDate" type="date" />
            </div>
          </div>
          <label htmlFor={customerVisibleId} className="flex items-center gap-2 text-sm">
            <input id={customerVisibleId} type="checkbox" name="customerVisible" className="size-4 rounded border-input" />
            Customer-visible
          </label>
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Add task
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AddDependencyForm({ projectId, tasks }: { projectId: string; tasks: ProjectTask[] }) {
  const [state, formAction, pending] = useActionState(addTaskDependencyAction, initialState);
  const taskId = useId();
  const dependsOnId = useId();
  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={taskId}>This task</Label>
              <select id={taskId} name="taskId" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" required>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={dependsOnId}>depends on</Label>
              <select id={dependsOnId} name="dependsOnTaskId" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" required>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" variant="outline" size="sm" className="w-fit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Add dependency
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
