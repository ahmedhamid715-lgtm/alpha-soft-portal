"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  updateProjectAction,
  transitionProjectAction,
  reopenProjectAction,
  cancelProjectAction,
  archiveProjectAction,
  completeProjectAction,
  completeProjectOverrideAction,
  addAttachmentAction,
  type ProjectActionState,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import type { Project, ProjectAttachment, CrmCompany, User } from "@/generated/prisma/client";
import type { ProjectCompletionResult } from "@/lib/projects/progress";

const initialState: ProjectActionState = {};

const UNMET_LABELS: Record<ProjectCompletionResult["unmet"][number], string> = {
  TASKS: "Required tasks",
  MILESTONES: "Milestones",
  QA: "Required QA checks",
  APPROVALS: "Approvals",
};

export function OverviewTab({
  project,
  company,
  assignableUsers,
  completion,
  attachments,
  canManage,
}: {
  project: Project;
  company: CrmCompany;
  assignableUsers: User[];
  completion: ProjectCompletionResult;
  attachments: ProjectAttachment[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <SectionHeader title="Details" />
          {project.description ? <p className="text-sm text-muted-foreground">{project.description}</p> : <p className="text-sm text-muted-foreground">No description.</p>}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Customer: </span>
              {company.name}
            </div>
            <div>
              <span className="text-muted-foreground">Start: </span>
              {project.startDate ? new Date(project.startDate).toLocaleDateString() : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Target end: </span>
              {project.targetEndDate ? new Date(project.targetEndDate).toLocaleDateString() : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Source: </span>
              {project.sourceTemplateId ? "Template" : project.originatingOnboardingId ? "Onboarding handoff" : "Manual"}
            </div>
          </div>
        </CardContent>
      </Card>

      {canManage ? <OwnerForm project={project} assignableUsers={assignableUsers} /> : null}
      {canManage ? <LifecycleControls project={project} completion={completion} /> : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Files" />
        {attachments.length === 0 ? <EmptyState title="No files yet" /> : (
          <div className="flex flex-col gap-2">
            {attachments.map((a) => (
              <Card key={a.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    {a.externalUrl ? (
                      <a href={a.externalUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
                        {a.title}
                      </a>
                    ) : (
                      <span className="text-sm font-medium">{a.title}</span>
                    )}
                    {a.description ? <span className="text-xs text-muted-foreground">{a.description}</span> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{a.visibility === "CUSTOMER_VISIBLE" ? "Customer-visible" : "Internal"}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {canManage ? <AddAttachmentForm projectId={project.id} /> : null}
      </section>
    </div>
  );
}

function OwnerForm({ project, assignableUsers }: { project: Project; assignableUsers: User[] }) {
  const [state, formAction, pending] = useActionState(updateProjectAction, initialState);
  const ownerId = useId();
  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex items-end gap-3">
          {state.error ? (
            <Alert variant="destructive" role="alert" className="w-full">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <input type="hidden" name="projectId" value={project.id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ownerId}>Owner</Label>
            <select id={ownerId} name="ownerUserId" defaultValue={project.ownerUserId ?? ""} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Save owner
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const NEXT_STATUSES: Record<string, ("PLANNED" | "ACTIVE" | "ON_HOLD")[]> = {
  DRAFT: ["PLANNED"],
  PLANNED: ["ACTIVE"],
  ACTIVE: ["ON_HOLD"],
  ON_HOLD: ["ACTIVE"],
};

function LifecycleControls({ project, completion }: { project: Project; completion: ProjectCompletionResult }) {
  const [transitionState, transitionAction, transitionPending] = useActionState(transitionProjectAction, initialState);
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenProjectAction, initialState);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelProjectAction, initialState);
  const [archiveState, archiveAction, archivePending] = useActionState(archiveProjectAction, initialState);
  const [completeState, completeAction, completePending] = useActionState(completeProjectAction, initialState);
  const [overrideState, overrideAction, overridePending] = useActionState(completeProjectOverrideAction, initialState);
  const cancelReasonId = useId();
  const overrideReasonId = useId();

  const nextStatuses = NEXT_STATUSES[project.status] ?? [];
  const error = transitionState.error ?? reopenState.error ?? cancelState.error ?? archiveState.error ?? completeState.error ?? overrideState.error;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <SectionHeader title="Lifecycle" />
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {nextStatuses.map((to) => (
            <form key={to} action={transitionAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="status" value={to} />
              <Button type="submit" variant="outline" size="sm" disabled={transitionPending}>
                Move to {to.replace("_", " ")}
              </Button>
            </form>
          ))}

          {project.status === "ACTIVE" ? (
            <form action={completeAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" size="sm" disabled={completePending || !completion.met}>
                Complete
              </Button>
            </form>
          ) : null}

          {project.status === "COMPLETED" ? (
            <form action={reopenAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" variant="outline" size="sm" disabled={reopenPending}>
                Reopen
              </Button>
            </form>
          ) : null}

          {(project.status === "COMPLETED" || project.status === "CANCELLED") ? (
            <form action={archiveAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" variant="outline" size="sm" disabled={archivePending}>
                Archive
              </Button>
            </form>
          ) : null}
        </div>

        {project.status === "ACTIVE" && !completion.met ? (
          <p className="text-xs text-muted-foreground">Not yet ready to complete — outstanding: {completion.unmet.map((g) => UNMET_LABELS[g]).join(", ")}.</p>
        ) : null}

        {project.status === "ACTIVE" && !completion.met ? (
          <form action={overrideAction} className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor={overrideReasonId}>Force-complete reason (privileged override)</Label>
              <Input id={overrideReasonId} name="reason" maxLength={1000} required />
            </div>
            <input type="hidden" name="projectId" value={project.id} />
            <Button type="submit" variant="destructive" size="sm" disabled={overridePending}>
              Force complete
            </Button>
          </form>
        ) : null}

        {!["COMPLETED", "CANCELLED", "ARCHIVED"].includes(project.status) ? (
          <form action={cancelAction} className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label htmlFor={cancelReasonId}>Cancellation reason</Label>
              <Input id={cancelReasonId} name="reason" maxLength={1000} required />
            </div>
            <input type="hidden" name="projectId" value={project.id} />
            <Button type="submit" variant="destructive" size="sm" disabled={cancelPending}>
              Cancel project
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddAttachmentForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addAttachmentAction, initialState);
  const titleId = useId();
  const urlId = useId();
  const visibilityId = useId();
  return (
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
          <Label htmlFor={titleId}>Title</Label>
          <Input id={titleId} name="title" maxLength={200} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={urlId}>Link (https://)</Label>
          <Input id={urlId} name="externalUrl" type="url" maxLength={2000} />
        </div>
      </div>
      <label htmlFor={visibilityId} className="flex items-center gap-2 text-sm">
        <Checkbox id={visibilityId} name="visibility" value="CUSTOMER_VISIBLE" />
        Customer-visible
      </label>
      <Button type="submit" variant="outline" size="sm" className="w-fit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Add file
      </Button>
    </form>
  );
}
