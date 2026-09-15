"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, AlertTriangle } from "lucide-react";
import { createLocalSeoIssueManuallyAction, acknowledgeLocalSeoIssueAction, resolveLocalSeoIssueAction, ignoreLocalSeoIssueAction, reopenLocalSeoIssueAction, linkLocalSeoIssueToTaskAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import type { LocalSeoIssue } from "@/generated/prisma/client";

const ISSUE_TYPES = ["NAP_INCONSISTENCY", "MISSING_LISTING", "PROFILE_INCOMPLETE", "UNVERIFIED_PROFILE", "REVIEW_RESPONSE_BACKLOG", "OTHER"];

const SEVERITY_TONE: Record<string, "destructive" | "warning" | "neutral"> = { CRITICAL: "destructive", WARNING: "warning", INFO: "neutral" };
const STATUS_TONE: Record<string, "warning" | "neutral" | "success"> = { OPEN: "warning", ACKNOWLEDGED: "neutral", RESOLVED: "success", IGNORED: "neutral" };

/** Local SEO issues are location-scoped, not per-page (no `pageUrl`-equivalent dimension — unlike SEO OS's own `SeoIssue`). */
export function IssuesTab({ locationId, initialItems, canManageMeasurements }: { locationId: string; initialItems: LocalSeoIssue[]; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showIgnoreFor, setShowIgnoreFor] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");
  const router = useRouter();
  const titleId = useId();
  const typeId = useId();
  const severityId = useId();

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

  function handleAdd(formData: FormData) {
    const title = formData.get("title");
    const issueType = formData.get("issueType");
    const severity = formData.get("severity");
    runAction(
      () => createLocalSeoIssueManuallyAction({ locationId, title: typeof title === "string" ? title : "", issueType: typeof issueType === "string" ? issueType : "OTHER", severity: typeof severity === "string" ? severity : "WARNING" }),
      () => setShowAdd(false),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManageMeasurements ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            Record issue
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAdd} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={titleId}>Title</Label>
                <Input id={titleId} name="title" required disabled={pending} className="w-64" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={typeId}>Type</Label>
                <select id={typeId} name="issueType" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  {ISSUE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={severityId}>Severity</Label>
                <select id={severityId} name="severity" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="CRITICAL">Critical</option>
                  <option value="WARNING">Warning</option>
                  <option value="INFO">Info</option>
                </select>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Record
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No issues" description="Nothing detected on this location." />
      ) : (
        <div className="flex flex-col gap-2">
          {initialItems.map((issue) => (
            <Card key={issue.id}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{issue.title}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={SEVERITY_TONE[issue.severity]}>{issue.severity}</StatusBadge>
                    <StatusBadge status={STATUS_TONE[issue.status]}>{issue.status}</StatusBadge>
                  </div>
                </div>
                {issue.description ? <p className="text-xs text-muted-foreground">{issue.description}</p> : null}
                {canManageMeasurements ? (
                  <div className="flex flex-wrap gap-2">
                    {issue.status === "OPEN" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => acknowledgeLocalSeoIssueAction({ issueId: issue.id }))}>
                        Acknowledge
                      </Button>
                    ) : null}
                    {issue.status === "OPEN" || issue.status === "ACKNOWLEDGED" ? (
                      <>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => resolveLocalSeoIssueAction({ issueId: issue.id }))}>
                          Resolve
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowIgnoreFor(showIgnoreFor === issue.id ? null : issue.id)}>
                          Ignore
                        </Button>
                      </>
                    ) : null}
                    {issue.status === "RESOLVED" || issue.status === "IGNORED" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => reopenLocalSeoIssueAction({ issueId: issue.id }))}>
                        Reopen
                      </Button>
                    ) : null}
                    {!issue.linkedTaskId ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => linkLocalSeoIssueToTaskAction({ issueId: issue.id }))}>
                        Create task
                      </Button>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">Task created</span>
                    )}
                  </div>
                ) : null}
                {showIgnoreFor === issue.id ? (
                  <div className="flex items-end gap-2 border-t pt-2">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor={`ignore-reason-${issue.id}`}>Reason</Label>
                      <Input id={`ignore-reason-${issue.id}`} value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} disabled={pending} required />
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending || ignoreReason.trim().length === 0}
                      onClick={() =>
                        runAction(
                          () => ignoreLocalSeoIssueAction({ issueId: issue.id, reason: ignoreReason }),
                          () => {
                            setShowIgnoreFor(null);
                            setIgnoreReason("");
                          },
                        )
                      }
                    >
                      Confirm
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
