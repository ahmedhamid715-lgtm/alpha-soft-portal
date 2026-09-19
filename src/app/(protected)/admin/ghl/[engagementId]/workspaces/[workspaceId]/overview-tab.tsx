"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateGhlWorkspaceAction, archiveGhlWorkspaceAction, reactivateGhlWorkspaceAction, recordGhlGoLiveAction, recordGhlHandoffAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { GhlWorkspaceOverview } from "@/server/services/ghl-engagement-service";

/**
 * Workspace overview (Build 34 — Roadmap Module 28). `recordGhlGoLive()`
 * is the ONLY path that ever sets a workspace's status to LIVE, and
 * `recordGhlHandoff()` is the ONLY path that ever sets `handoffStatus`
 * to COMPLETED — this form never infers either from assets/integrations
 * merely looking complete. Recording a workspace here is EVIDENCE,
 * never a claim that Alpha OS itself activated a GoHighLevel account,
 * connected an integration, or performed any live automation action.
 */
export function OverviewTab({ overview, canManage, canLaunch }: { overview: GhlWorkspaceOverview; canManage: boolean; canLaunch: boolean }) {
  const { workspace, readiness } = overview;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showGoLive, setShowGoLive] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const router = useRouter();
  const goLiveTargetId = useId();
  const overrideId = useId();
  const handoffNotesId = useId();

  function runAction(action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function handleUpdate(formData: FormData) {
    const goLiveTargetDate = formData.get("goLiveTargetDate");
    runAction(() =>
      updateGhlWorkspaceAction({
        workspaceId: workspace.id,
        goLiveTargetDate: typeof goLiveTargetDate === "string" && goLiveTargetDate.length > 0 ? `${goLiveTargetDate}T00:00:00.000Z` : null,
      }),
    );
  }

  function handleGoLive(formData: FormData) {
    const overrideReason = formData.get("overrideReason");
    runAction(
      () => recordGhlGoLiveAction({ workspaceId: workspace.id, overrideReason: typeof overrideReason === "string" && overrideReason.trim().length > 0 ? overrideReason.trim() : null }),
      () => setShowGoLive(false),
    );
  }

  function handleHandoff(formData: FormData) {
    const handoffNotes = formData.get("handoffNotes");
    runAction(
      () => recordGhlHandoffAction({ workspaceId: workspace.id, handoffNotes: typeof handoffNotes === "string" && handoffNotes.trim().length > 0 ? handoffNotes.trim() : null }),
      () => setShowHandoff(false),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <Field label="External location ID" value={workspace.externalLocationId ?? "Not recorded"} />
            <Field label="Location URL" value={workspace.locationUrl ?? "Not recorded"} />
            <Field label="Go-live target" value={workspace.goLiveTargetDate ? formatInTimeZone(workspace.goLiveTargetDate, "UTC", { hour: undefined, minute: undefined }) : "Not set"} />
            <Field label="Go-live recorded" value={workspace.goLiveRecordedAt ? formatInTimeZone(workspace.goLiveRecordedAt, "UTC", { hour: undefined, minute: undefined }) : "Not yet"} />
            <Field label="Handoff status" value={workspace.handoffStatus.replace("_", " ")} />
            <Field label="Handoff recorded" value={workspace.handoffRecordedAt ? formatInTimeZone(workspace.handoffRecordedAt, "UTC", { hour: undefined, minute: undefined }) : "Not yet"} />
          </div>
          {workspace.handoffNotes ? <p className="text-xs text-muted-foreground">{workspace.handoffNotes}</p> : null}
        </CardContent>
      </Card>

      {canManage && workspace.status !== "ARCHIVED" ? (
        <Card>
          <CardContent>
            <form action={handleUpdate} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={goLiveTargetId}>Go-live target date</Label>
                <Input id={goLiveTargetId} name="goLiveTargetDate" type="date" defaultValue={workspace.goLiveTargetDate ? workspace.goLiveTargetDate.toISOString().slice(0, 10) : ""} disabled={pending} />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <div className="flex items-center gap-2">
          {workspace.status === "ARCHIVED" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => reactivateGhlWorkspaceAction({ workspaceId: workspace.id }))}>
              Reactivate workspace
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => archiveGhlWorkspaceAction({ workspaceId: workspace.id }))}>
              Archive workspace
            </Button>
          )}
        </div>
      ) : null}

      {canLaunch && workspace.status !== "LIVE" && workspace.status !== "ARCHIVED" ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium">Record go-live</p>
            <p className="text-xs text-muted-foreground">
              Readiness: <span className="font-medium">{readiness.status.replace("_", " ")}</span>
              {readiness.reasons.length > 0 ? ` — ${readiness.reasons.join(" ")}` : ""}
            </p>
            {!showGoLive ? (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setShowGoLive(true)}>
                {readiness.status === "READY" ? "Record go-live" : "Record go-live (override)"}
              </Button>
            ) : (
              <form action={handleGoLive} className="flex flex-wrap items-end gap-2">
                {readiness.status !== "READY" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={overrideId}>Override reason (required — this workspace is not go-live-ready)</Label>
                    <Input id={overrideId} name="overrideReason" required className="w-80" disabled={pending} />
                  </div>
                ) : (
                  <input type="hidden" name="overrideReason" value="" />
                )}
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Confirm go-live
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setShowGoLive(false)}>
                  Cancel
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canLaunch && workspace.handoffStatus !== "COMPLETED" ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium">Record handoff</p>
            <p className="text-xs text-muted-foreground">Captures training/documentation evidence as notes — never a fabricated attendance record or customer acknowledgement.</p>
            {!showHandoff ? (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setShowHandoff(true)}>
                Record handoff
              </Button>
            ) : (
              <form action={handleHandoff} className="flex flex-col gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={handoffNotesId}>Handoff notes (optional — training/documentation evidence)</Label>
                  <Textarea id={handoffNotesId} name="handoffNotes" className="w-full max-w-md" rows={3} disabled={pending} />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Confirm handoff
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setShowHandoff(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
