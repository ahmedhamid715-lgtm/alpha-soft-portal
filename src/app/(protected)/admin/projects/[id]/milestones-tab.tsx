"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createMilestoneAction, cancelMilestoneAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectProgressDisplay } from "@/components/projects/project-progress-display";
import type { Milestone } from "@/generated/prisma/client";
import type { ProjectProgress } from "@/lib/projects/progress";

const initialState: ProjectActionState = {};

export function MilestonesTab({ projectId, milestones, milestoneProgressById, canManage }: { projectId: string; milestones: Milestone[]; milestoneProgressById: Map<string, ProjectProgress>; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {milestones.length === 0 ? (
        <EmptyState title="No milestones yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {milestones.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{m.title}</span>
                  <div className="flex items-center gap-2">
                    {m.customerVisible ? <StatusBadge status="info">Customer-visible</StatusBadge> : null}
                    {m.cancelledAt ? <StatusBadge status="destructive">Cancelled</StatusBadge> : null}
                  </div>
                </div>
                {m.description ? <p className="text-sm text-muted-foreground">{m.description}</p> : null}
                <ProjectProgressDisplay progress={milestoneProgressById.get(m.id) ?? { kind: "NOT_MEASURABLE" }} label="Milestone progress" />
                <span className="text-xs text-muted-foreground">Target: {m.targetDate ? new Date(m.targetDate).toLocaleDateString() : "—"}</span>
                {canManage && !m.cancelledAt ? <CancelMilestoneForm projectId={projectId} milestoneId={m.id} /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canManage ? <AddMilestoneForm projectId={projectId} /> : null}
    </div>
  );
}

function AddMilestoneForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createMilestoneAction, initialState);
  const titleId = useId();
  const descriptionId = useId();
  const targetDateId = useId();
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={targetDateId}>Target date</Label>
            <Input id={targetDateId} name="targetDate" type="date" />
          </div>
          <label htmlFor={customerVisibleId} className="flex items-center gap-2 text-sm">
            <input id={customerVisibleId} type="checkbox" name="customerVisible" className="size-4 rounded border-input" />
            Customer-visible
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

function CancelMilestoneForm({ projectId, milestoneId }: { projectId: string; milestoneId: string }) {
  const [state, formAction, pending] = useActionState(cancelMilestoneAction, initialState);
  const reasonId = useId();
  return (
    <form action={formAction} className="flex items-end gap-2">
      {state.error ? (
        <Alert variant="destructive" role="alert" className="w-full">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <div className="flex flex-col gap-1.5 flex-1">
        <Label htmlFor={reasonId}>Cancellation reason</Label>
        <Input id={reasonId} name="reason" maxLength={1000} required />
      </div>
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        Cancel milestone
      </Button>
    </form>
  );
}
