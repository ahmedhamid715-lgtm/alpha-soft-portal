"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, ClipboardList } from "lucide-react";
import { recordSeoAuditRunAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { SeoAuditRun } from "@/generated/prisma/client";

const ISSUE_TYPES = ["BROKEN_LINK", "MISSING_TITLE", "MISSING_META_DESCRIPTION", "DUPLICATE_TITLE", "DUPLICATE_META_DESCRIPTION", "MISSING_H1", "SLOW_PAGE_SPEED", "MISSING_ALT_TEXT", "REDIRECT_CHAIN", "NOINDEX_CONFLICT", "THIN_CONTENT", "MOBILE_USABILITY", "OTHER"];

export function AuditsTab({ propertyId, initialRuns, canManageMeasurements }: { propertyId: string; initialRuns: SeoAuditRun[]; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [includeIssue, setIncludeIssue] = useState(false);
  const router = useRouter();
  const dateId = useId();
  const summaryId = useId();
  const issueTitleId = useId();
  const issueTypeId = useId();
  const issueSeverityId = useId();

  function handleSubmit(formData: FormData) {
    const startedAt = formData.get("startedAt");
    const summary = formData.get("summary");
    const issueTitle = formData.get("issueTitle");
    startTransition(async () => {
      const result = await recordSeoAuditRunAction({
        propertyId,
        startedAt: typeof startedAt === "string" ? `${startedAt}T00:00:00.000Z` : "",
        summary: typeof summary === "string" && summary.length > 0 ? summary : null,
        issues:
          includeIssue && typeof issueTitle === "string" && issueTitle.length > 0
            ? [{ title: issueTitle, issueType: formData.get("issueType") ?? "OTHER", severity: formData.get("issueSeverity") ?? "WARNING" }]
            : [],
      });
      setError(result.error ?? null);
      if (!result.error) {
        setShowAdd(false);
        setIncludeIssue(false);
        router.refresh();
      }
    });
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
            Record audit
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={dateId}>Date</Label>
                  <Input id={dateId} name="startedAt" type="date" required disabled={pending} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor={summaryId}>Summary (optional)</Label>
                  <Input id={summaryId} name="summary" disabled={pending} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeIssue} onChange={(e) => setIncludeIssue(e.target.checked)} disabled={pending} />
                Found an issue during this audit
              </label>
              {includeIssue ? (
                <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={issueTitleId}>Issue title</Label>
                    <Input id={issueTitleId} name="issueTitle" required={includeIssue} disabled={pending} className="w-64" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={issueTypeId}>Type</Label>
                    <select id={issueTypeId} name="issueType" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                      {ISSUE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={issueSeverityId}>Severity</Label>
                    <select id={issueSeverityId} name="issueSeverity" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                      <option value="CRITICAL">Critical</option>
                      <option value="WARNING">Warning</option>
                      <option value="INFO">Info</option>
                    </select>
                  </div>
                </div>
              ) : null}
              <Button type="submit" disabled={pending} className="w-fit">
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Save audit
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialRuns.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No audits recorded yet" description="Record a technical audit to start tracking issues over time." />
      ) : (
        <div className="flex flex-col gap-2">
          {initialRuns.map((run) => (
            <Card key={run.id}>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{formatInTimeZone(run.startedAt, "UTC", { hour: undefined, minute: undefined })}</span>
                  {run.summary ? <span className="text-xs text-muted-foreground">{run.summary}</span> : null}
                </div>
                <StatusBadge status={run.status === "COMPLETED" ? "success" : "destructive"}>{run.status}</StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
