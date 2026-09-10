"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { addTemplateMilestoneAction, addTemplateTaskAction, addTemplateQaCheckAction, archiveTemplateAction, reactivateTemplateAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectTemplateMilestone } from "@/generated/prisma/client";

const initialState: ProjectActionState = {};

export function ArchiveToggleForm({ templateId, status }: { templateId: string; status: string }) {
  const [state, formAction, pending] = useActionState(status === "ACTIVE" ? archiveTemplateAction : reactivateTemplateAction, initialState);
  return (
    <form action={formAction}>
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="templateId" value={templateId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {status === "ACTIVE" ? "Archive" : "Reactivate"}
      </Button>
    </form>
  );
}

export function AddTemplateMilestoneForm({ templateId }: { templateId: string }) {
  const [state, formAction, pending] = useActionState(addTemplateMilestoneAction, initialState);
  const titleId = useId();
  const descriptionId = useId();
  const dueId = useId();
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
          <input type="hidden" name="templateId" value={templateId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} name="title" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={5000} rows={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dueId}>Relative due (days after project start)</Label>
            <Input id={dueId} name="relativeDueDays" type="number" min={0} max={3650} />
          </div>
          <label htmlFor={customerVisibleId} className="flex items-center gap-2 text-sm">
            <input id={customerVisibleId} type="checkbox" name="customerVisible" className="size-4 rounded border-input" />
            Customer-visible when instantiated
          </label>
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Add milestone
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AddTemplateTaskForm({ templateId, milestones }: { templateId: string; milestones: ProjectTemplateMilestone[] }) {
  const [state, formAction, pending] = useActionState(addTemplateTaskAction, initialState);
  const titleId = useId();
  const descriptionId = useId();
  const milestoneId = useId();
  const dueId = useId();
  const priorityId = useId();
  const roleHintId = useId();
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
          <input type="hidden" name="templateId" value={templateId} />
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
              <select id={milestoneId} name="templateMilestoneId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">None</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={dueId}>Relative due (days)</Label>
              <Input id={dueId} name="relativeDueDays" type="number" min={0} max={3650} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Label htmlFor={roleHintId}>Staffing hint (free text)</Label>
              <Input id={roleHintId} name="defaultAssigneeRoleHint" maxLength={200} placeholder="e.g. SEO Specialist" />
            </div>
          </div>
          <label htmlFor={customerVisibleId} className="flex items-center gap-2 text-sm">
            <input id={customerVisibleId} type="checkbox" name="customerVisible" className="size-4 rounded border-input" />
            Customer-visible when instantiated
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

export function AddTemplateQaCheckForm({ templateId }: { templateId: string }) {
  const [state, formAction, pending] = useActionState(addTemplateQaCheckAction, initialState);
  const titleId = useId();
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
          <input type="hidden" name="templateId" value={templateId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} name="title" maxLength={200} required />
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
