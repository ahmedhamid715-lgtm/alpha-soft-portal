"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createQaCheckAction, recordQaCheckAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { projectQaCheckStatusVariant } from "@/components/projects/project-status";
import type { Milestone, ProjectQaCheck, ProjectTask } from "@/generated/prisma/client";

const initialState: ProjectActionState = {};

export function QaTab({
  projectId,
  tasks,
  milestones,
  qaChecks,
  canManage,
  canQa,
}: {
  projectId: string;
  tasks: ProjectTask[];
  milestones: Milestone[];
  qaChecks: ProjectQaCheck[];
  canManage: boolean;
  canQa: boolean;
}) {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col gap-4">
      {qaChecks.length === 0 ? (
        <EmptyState title="No QA checks yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {qaChecks.map((q) => (
            <Card key={q.id}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{q.title}</span>
                  <div className="flex items-center gap-2">
                    {q.required ? <StatusBadge status="warning">Required</StatusBadge> : null}
                    <StatusBadge status={projectQaCheckStatusVariant(q.status)}>{q.status}</StatusBadge>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  Scope: {q.taskId ? (taskById.get(q.taskId)?.title ?? "task") : q.milestoneId ? (milestoneById.get(q.milestoneId)?.title ?? "milestone") : "Project-wide"}
                </span>
                {q.notes ? <p className="text-sm text-muted-foreground">{q.notes}</p> : null}
                {canQa && q.status === "PENDING" ? <RecordQaForm projectId={projectId} qaCheckId={q.id} /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canManage ? <AddQaCheckForm projectId={projectId} tasks={tasks} milestones={milestones} /> : null}
    </div>
  );
}

function RecordQaForm({ projectId, qaCheckId }: { projectId: string; qaCheckId: string }) {
  const [state, formAction, pending] = useActionState(recordQaCheckAction, initialState);
  const notesId = useId();
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="qaCheckId" value={qaCheckId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={notesId}>Notes</Label>
        <Textarea id={notesId} name="notes" maxLength={2000} rows={2} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="status" value="PASSED" size="sm" disabled={pending}>
          Pass
        </Button>
        <Button type="submit" name="status" value="FAILED" variant="destructive" size="sm" disabled={pending}>
          Fail
        </Button>
        <Button type="submit" name="status" value="WAIVED" variant="outline" size="sm" disabled={pending}>
          Waive
        </Button>
      </div>
    </form>
  );
}

function AddQaCheckForm({ projectId, tasks, milestones }: { projectId: string; tasks: ProjectTask[]; milestones: Milestone[] }) {
  const [state, formAction, pending] = useActionState(createQaCheckAction, initialState);
  const titleId = useId();
  const taskId = useId();
  const milestoneId = useId();
  const requiredId = useId();
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
          <p className="text-xs text-muted-foreground">Scope to a task OR a milestone, or leave both unset for a project-wide check — never both.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={taskId}>Task (optional)</Label>
              <select id={taskId} name="taskId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">None</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={milestoneId}>Milestone (optional)</Label>
              <select id={milestoneId} name="milestoneId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">None</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor={requiredId} className="flex items-center gap-2 text-sm">
            <input id={requiredId} type="checkbox" name="required" defaultChecked className="size-4 rounded border-input" />
            Required for project completion
          </label>
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Add QA check
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
