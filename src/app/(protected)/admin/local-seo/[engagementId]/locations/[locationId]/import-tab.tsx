"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { importLocalRankObservationsAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { ImportLocalRankObservationsResult } from "@/server/services/local-seo-measurement-service";

/**
 * Bulk local rank-observation CSV import (Build 31 — Roadmap Module 25).
 * Bulk-loads observations for ALREADY-TRACKED local keywords only — a
 * row that doesn't match an existing keyword (add it on the Keywords
 * tab first, with the same device/search-point label) is reported as
 * skipped, never guessed/auto-created. Required columns: phrase,
 * observedAt (YYYY-MM-DD), rankStatus (RANKED/NOT_FOUND/
 * BEYOND_TRACKED_RANGE/SOURCE_ERROR); optional: position (required when
 * rankStatus is RANKED), rankingProfileUrl, notes.
 */
export function ImportTab({ locationId, canManageMeasurements }: { locationId: string; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportLocalRankObservationsResult | null>(null);
  const router = useRouter();
  const fileId = useId();
  const deviceId = useId();
  const searchLabelId = useId();

  if (!canManageMeasurements) {
    return <p className="text-sm text-muted-foreground">Importing local rank data requires the local_seo.measurements.manage permission.</p>;
  }

  function handleSubmit(formData: FormData) {
    const file = formData.get("file");
    const device = formData.get("device");
    const searchLabel = formData.get("searchLabel");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file to import.");
      return;
    }
    startTransition(async () => {
      const fileContent = await file.text();
      const importResult = await importLocalRankObservationsAction({
        locationId,
        device: typeof device === "string" ? device : "DESKTOP",
        searchLabel: typeof searchLabel === "string" && searchLabel.length > 0 ? searchLabel : null,
        fileName: file.name,
        fileContent,
      });
      setError(importResult.error ?? null);
      setResult(importResult.data ?? null);
      if (!importResult.error) router.refresh();
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
      {result ? (
        <Alert>
          <CheckCircle2 />
          <AlertDescription>
            Imported {result.importedCount} of {result.rowCount} row(s). {result.skippedCount > 0 ? `${result.skippedCount} skipped.` : ""}
            {result.skippedReasons.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs">
                {result.skippedReasons.slice(0, 20).map((r) => (
                  <li key={r.rowNumber}>
                    Row {r.rowNumber}: {r.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <form action={handleSubmit} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">CSV columns: phrase, observedAt (YYYY-MM-DD), rankStatus, position (when RANKED), rankingProfileUrl, notes.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={fileId}>CSV file</Label>
                <Input id={fileId} name="file" type="file" accept=".csv,text/csv" required disabled={pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={deviceId}>Device</Label>
                <select id={deviceId} name="device" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="DESKTOP">Desktop</option>
                  <option value="MOBILE">Mobile</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={searchLabelId}>Search point label (optional)</Label>
                <Input id={searchLabelId} name="searchLabel" placeholder="Downtown" disabled={pending} className="w-40" />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                Import
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
