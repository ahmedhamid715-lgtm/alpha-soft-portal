"use client";

import { Fragment, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { createSeoKeywordAction, archiveSeoKeywordAction, reactivateSeoKeywordAction, recordRankObservationAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Tags } from "lucide-react";
import type { SeoKeywordListItem } from "@/server/services/seo-engagement-service";

const RANK_STATUS_LABELS: Record<string, string> = { RANKED: "Ranked", NOT_FOUND: "Not found", BEYOND_TRACKED_RANGE: "Beyond tracked range", SOURCE_ERROR: "Source error" };

export function KeywordsTab({ propertyId, initialItems, canManage, canManageMeasurements }: { propertyId: string; initialItems: SeoKeywordListItem[]; canManage: boolean; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const router = useRouter();
  const phraseId = useId();
  const deviceId = useId();

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

  function handleAddKeyword(formData: FormData) {
    const phrase = formData.get("phrase");
    const device = formData.get("device");
    runAction(
      () => createSeoKeywordAction({ propertyId, phrase: typeof phrase === "string" ? phrase : "", device: typeof device === "string" ? device : "DESKTOP" }),
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

      {canManage ? (
        <div className="flex items-center justify-between">
          <span />
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            Add keyword
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAddKeyword} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={phraseId}>Keyword phrase</Label>
                <Input id={phraseId} name="phrase" required disabled={pending} className="w-64" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={deviceId}>Device</Label>
                <select id={deviceId} name="device" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="DESKTOP">Desktop</option>
                  <option value="MOBILE">Mobile</option>
                </select>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={Tags} title="No keywords tracked yet" description="Add a keyword to start recording its ranking." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Keywords table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Keyword</th>
                <th className="px-4 py-2.5">Device</th>
                <th className="px-4 py-2.5">Current</th>
                <th className="px-4 py-2.5">Previous</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {initialItems.map((k) => (
                <Fragment key={k.id}>
                  <tr className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{k.phrase}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{k.device}</td>
                    <td className="px-4 py-2.5">{k.currentRankStatus ? (k.currentRankStatus === "RANKED" ? `#${k.currentPosition}` : RANK_STATUS_LABELS[k.currentRankStatus]) : "No data"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{k.previousPosition !== null ? `#${k.previousPosition}` : "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={k.status === "ACTIVE" ? "success" : "neutral"}>{k.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {canManageMeasurements ? (
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRecordingFor(recordingFor === k.id ? null : k.id)}>
                            Record
                          </Button>
                        ) : null}
                        {canManage ? (
                          k.status === "ACTIVE" ? (
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => archiveSeoKeywordAction({ keywordId: k.id }))}>
                              Archive
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => reactivateSeoKeywordAction({ keywordId: k.id }))}>
                              Reactivate
                            </Button>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {recordingFor === k.id ? (
                    <tr>
                      <td colSpan={6} className="border-b border-border bg-muted/20 px-4 py-3">
                        <RecordObservationForm keywordId={k.id} onDone={() => setRecordingFor(null)} onError={setError} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecordObservationForm({ keywordId, onDone, onError }: { keywordId: string; onDone: () => void; onError: (e: string | null) => void }) {
  const [pending, startTransition] = useTransition();
  const [rankStatus, setRankStatus] = useState("RANKED");
  const router = useRouter();
  const dateId = useId();
  const positionId = useId();
  const rankStatusId = useId();

  function handleSubmit(formData: FormData) {
    const observedAt = formData.get("observedAt");
    const position = formData.get("position");
    startTransition(async () => {
      const result = await recordRankObservationAction({
        keywordId,
        observedAt: typeof observedAt === "string" ? `${observedAt}T00:00:00.000Z` : "",
        rankStatus,
        position: rankStatus === "RANKED" && typeof position === "string" && position.length > 0 ? position : null,
      });
      onError(result.error ?? null);
      if (!result.error) {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={dateId}>Date</Label>
        <Input id={dateId} name="observedAt" type="date" required disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={rankStatusId}>Status</Label>
        <select id={rankStatusId} value={rankStatus} onChange={(e) => setRankStatus(e.target.value)} disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="RANKED">Ranked</option>
          <option value="NOT_FOUND">Not found</option>
          <option value="BEYOND_TRACKED_RANGE">Beyond tracked range</option>
          <option value="SOURCE_ERROR">Source error</option>
        </select>
      </div>
      {rankStatus === "RANKED" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={positionId}>Position</Label>
          <Input id={positionId} name="position" type="number" min={1} required disabled={pending} className="w-20" />
        </div>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
