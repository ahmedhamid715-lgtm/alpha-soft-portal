"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { requestApprovalAction, decideApprovalAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { projectApprovalStatusVariant } from "@/components/projects/project-status";
import type { Milestone, ProjectApproval } from "@/generated/prisma/client";

const initialState: ProjectActionState = {};

/** Self-approval is rejected server-side (`project-approval-service.ts`) even if this UI's own `pendingByOthers` filter were somehow bypassed — that filter is a UX convenience, never the real boundary. */
export function ApprovalsTab({
  projectId,
  milestones,
  approvals,
  currentUserId,
  canManage,
  canApprove,
}: {
  projectId: string;
  milestones: Milestone[];
  approvals: ProjectApproval[];
  currentUserId: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col gap-4">
      {approvals.length === 0 ? (
        <EmptyState title="No approval requests yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {approvals.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{a.resourceType === "PROJECT" ? "Whole project" : (milestoneById.get(a.resourceId)?.title ?? "Milestone")}</span>
                  <StatusBadge status={projectApprovalStatusVariant(a.status)}>{a.status}</StatusBadge>
                </div>
                {a.reason ? <p className="text-sm text-muted-foreground">{a.reason}</p> : null}
                {canApprove && a.status === "PENDING" && a.requestedByUserId !== currentUserId ? <DecideForm projectId={projectId} approvalId={a.id} /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {canManage ? <RequestApprovalForm projectId={projectId} milestones={milestones} /> : null}
    </div>
  );
}

function DecideForm({ projectId, approvalId }: { projectId: string; approvalId: string }) {
  const [state, formAction, pending] = useActionState(decideApprovalAction, initialState);
  const reasonId = useId();
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="approvalId" value={approvalId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>Reason (required to reject)</Label>
        <Textarea id={reasonId} name="reason" maxLength={1000} rows={2} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="APPROVED" size="sm" disabled={pending}>
          Approve
        </Button>
        <Button type="submit" name="decision" value="REJECTED" variant="destructive" size="sm" disabled={pending}>
          Reject
        </Button>
      </div>
    </form>
  );
}

function RequestApprovalForm({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const [state, formAction, pending] = useActionState(requestApprovalAction, initialState);
  const resourceId = useId();
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
          <input type="hidden" name="projectId" value={projectId} />
          <div className="flex flex-col gap-1.5 flex-1">
            <Label htmlFor={resourceId}>Request approval for</Label>
            <select
              id={resourceId}
              name="resourceCombo"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              onChange={(e) => {
                const form = e.currentTarget.form!;
                const [type, id] = e.currentTarget.value.split("|");
                (form.elements.namedItem("resourceType") as HTMLInputElement).value = type ?? "";
                (form.elements.namedItem("resourceId") as HTMLInputElement).value = id ?? "";
              }}
              defaultValue={`PROJECT|${projectId}`}
            >
              <option value={`PROJECT|${projectId}`}>Whole project</option>
              {milestones.map((m) => (
                <option key={m.id} value={`MILESTONE|${m.id}`}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
          <input type="hidden" name="resourceType" defaultValue="PROJECT" />
          <input type="hidden" name="resourceId" defaultValue={projectId} />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Request approval
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
