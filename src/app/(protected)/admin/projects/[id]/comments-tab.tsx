"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { addCommentAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import type { ProjectComment, ProjectTask } from "@/generated/prisma/client";

const initialState: ProjectActionState = {};

/** Plain-text comments only — rendered as text content below, never `dangerouslySetInnerHTML` (see `project-comment-repository.ts`'s own doc comment). */
export function CommentsTab({ projectId, tasks, comments, canManage }: { projectId: string; tasks: ProjectTask[]; comments: ProjectComment[]; canManage: boolean }) {
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 ? (
        <EmptyState title="No comments yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {comments.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{c.taskId ? `On: ${taskById.get(c.taskId)?.title ?? c.taskId}` : "Project-level"}</span>
                  {c.visibility === "CUSTOMER_VISIBLE" ? <StatusBadge status="info">Customer-visible</StatusBadge> : null}
                </div>
                <p className="text-sm">{c.body}</p>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.editedAt ? " (edited)" : ""}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canManage ? <AddCommentForm projectId={projectId} tasks={tasks} /> : null}
    </div>
  );
}

function AddCommentForm({ projectId, tasks }: { projectId: string; tasks: ProjectTask[] }) {
  const [state, formAction, pending] = useActionState(addCommentAction, initialState);
  const bodyId = useId();
  const taskId = useId();
  const visibilityId = useId();
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
            <label htmlFor={bodyId} className="text-sm font-medium">
              Comment
            </label>
            <Textarea id={bodyId} name="body" maxLength={5000} rows={3} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={taskId} className="text-sm font-medium">
              Attach to task (optional)
            </label>
            <select id={taskId} name="taskId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Project-level</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          <label htmlFor={visibilityId} className="flex items-center gap-2 text-sm">
            <Checkbox id={visibilityId} name="visibility" value="CUSTOMER_VISIBLE" />
            Customer-visible
          </label>
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Post comment
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
