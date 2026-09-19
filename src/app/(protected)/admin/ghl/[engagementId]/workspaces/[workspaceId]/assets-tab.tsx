"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Zap } from "lucide-react";
import { createGhlAssetAction, transitionGhlAssetStatusAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ghlAssetStatusVariant, GHL_ASSET_TYPE_LABELS } from "@/components/ghl/ghl-status";
import type { GhlAsset, GhlAssetImplementationStatus, GhlAssetType } from "@/generated/prisma/client";

const ASSET_STATUSES: GhlAssetImplementationStatus[] = ["PLANNED", "IN_PROGRESS", "READY_FOR_QA", "QA_FAILED", "READY", "LIVE", "ARCHIVED"];
const ASSET_TYPES = Object.keys(GHL_ASSET_TYPE_LABELS) as GhlAssetType[];

/** The implementation asset inventory (Build 34 — Roadmap Module 28). Bounded to 100 rows per load — see `page.tsx`'s own `listGhlAssets()` call; a real GHL account with hundreds of assets should paginate further, out of scope for this first pass. */
export function AssetsTab({ workspaceId, initialItems, hasNextPage, canManage }: { workspaceId: string; initialItems: GhlAsset[]; hasNextPage: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();
  const nameId = useId();
  const assetTypeId = useId();
  const externalIdId = useId();
  const requiredId = useId();

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
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createGhlAssetAction({
          workspaceId,
          name: str("name") ?? "",
          assetType: (str("assetType") ?? "OTHER") as GhlAssetType,
          externalAssetId: str("externalAssetId"),
          requiredForLaunch: formData.get("requiredForLaunch") === "on",
        }),
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
            Add asset
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAdd} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={nameId}>Name</Label>
                <Input id={nameId} name="name" required disabled={pending} className="w-56" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={assetTypeId}>Type</Label>
                <Select name="assetType" defaultValue="OTHER" disabled={pending}>
                  <SelectTrigger id={assetTypeId} className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {GHL_ASSET_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={externalIdId}>External asset ID (optional)</Label>
                <Input id={externalIdId} name="externalAssetId" disabled={pending} className="w-48" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id={requiredId} name="requiredForLaunch" defaultChecked disabled={pending} />
                <Label htmlFor={requiredId} className="font-normal">
                  Required for go-live
                </Label>
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
        <EmptyState icon={Zap} title="No assets tracked yet" description="Add an implementation asset (funnel, form, calendar, workflow, etc.) or import a CSV to start tracking implementation/QA status." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Assets table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Required</th>
                <th className="px-4 py-2.5">Status</th>
                {canManage ? (
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {initialItems.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{a.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{GHL_ASSET_TYPE_LABELS[a.assetType]}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.requiredForLaunch ? "Yes" : "No"}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={ghlAssetStatusVariant(a.implementationStatus)}>{a.implementationStatus.replace(/_/g, " ")}</StatusBadge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 text-right">
                      <Select value={a.implementationStatus} disabled={pending} onValueChange={(value) => runAction(() => transitionGhlAssetStatusAction({ assetId: a.id, status: value as GhlAssetImplementationStatus }))}>
                        <SelectTrigger className="ml-auto w-44" aria-label={`Change status for ${a.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSET_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasNextPage ? <p className="text-xs text-muted-foreground">Showing the first 100 assets. Additional assets are not shown here yet.</p> : null}
    </div>
  );
}
