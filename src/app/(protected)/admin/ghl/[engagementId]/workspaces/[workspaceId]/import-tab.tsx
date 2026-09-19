"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { importGhlAssetCsvAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { GhlAssetImportResult } from "@/server/services/ghl-asset-service";
import type { GhlImportBatch } from "@/generated/prisma/client";

/**
 * Manual CSV asset import (Build 34 — Roadmap Module 28). Every import
 * batch is append-only evidence — it can never be edited or deleted
 * here. Required columns: name, assetType; optional: externalAssetId,
 * status, requiredForLaunch (true/false), notes. Importing a file means
 * "Alpha OS received this file," never "Alpha OS synchronized with
 * GoHighLevel."
 */
export function ImportTab({ workspaceId, initialBatches, canManage }: { workspaceId: string; initialBatches: GhlImportBatch[]; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GhlAssetImportResult | null>(null);
  const router = useRouter();
  const fileId = useId();

  function handleSubmit(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file to import.");
      return;
    }
    startTransition(async () => {
      const fileContent = await file.text();
      const importResult = await importGhlAssetCsvAction({ workspaceId, fileContent });
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
            Imported {result.importedRowCount} of {result.totalRowCount} row(s). {result.skippedRowCount > 0 ? `${result.skippedRowCount} skipped.` : ""}
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

      {canManage ? (
        <Card>
          <CardContent>
            <form action={handleSubmit} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">CSV columns: name, assetType, externalAssetId, status, requiredForLaunch (true/false), notes.</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={fileId}>CSV file</Label>
                  <Input id={fileId} name="file" type="file" accept=".csv,text/csv" required disabled={pending} />
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                  Import
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialBatches.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Import history</p>
          {initialBatches.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex items-center justify-between gap-4 text-sm">
                <span>
                  {b.importedRowCount}/{b.totalRowCount} rows imported{b.skippedRowCount > 0 ? `, ${b.skippedRowCount} skipped` : ""}
                </span>
                <span className="text-xs text-muted-foreground">{formatInTimeZone(b.createdAt, "UTC", { hour: undefined, minute: undefined })}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
