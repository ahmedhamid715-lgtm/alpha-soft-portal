"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateEcommerceStoreAction, archiveEcommerceStoreAction, reactivateEcommerceStoreAction, recordEcommerceStoreLaunchAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { ECOMMERCE_PLATFORM_LABELS } from "@/components/ecommerce/ecommerce-status";
import type { EcommerceStoreOverview } from "@/server/services/ecommerce-engagement-service";

/**
 * Store overview (Build 33 — Roadmap Module 27). `recordEcommerceStoreLaunch()`
 * is the ONLY path that ever sets a store's status to LIVE — this form
 * never infers a launch from a linked website's own launch. Recording a
 * store here is EVIDENCE, never a claim that Alpha OS itself connected a
 * payment provider, deployed a storefront, or performed any live
 * commerce action. See docs/architecture/ecommerce-development-os.md
 * "Launch/live semantics."
 */
export function OverviewTab({ overview, canManage, canLaunch }: { overview: EcommerceStoreOverview; canManage: boolean; canLaunch: boolean }) {
  const { store, readiness } = overview;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const router = useRouter();
  const launchTargetId = useId();
  const overrideId = useId();

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
    const launchTargetDate = formData.get("launchTargetDate");
    runAction(() =>
      updateEcommerceStoreAction({
        storeId: store.id,
        launchTargetDate: typeof launchTargetDate === "string" && launchTargetDate.length > 0 ? `${launchTargetDate}T00:00:00.000Z` : null,
      }),
    );
  }

  function handleLaunch(formData: FormData) {
    const overrideReason = formData.get("overrideReason");
    runAction(
      () => recordEcommerceStoreLaunchAction({ storeId: store.id, overrideReason: typeof overrideReason === "string" && overrideReason.trim().length > 0 ? overrideReason.trim() : null }),
      () => setShowLaunch(false),
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
            <Field label="Platform" value={ECOMMERCE_PLATFORM_LABELS[store.platform]} />
            <Field label="External identifier" value={store.externalStoreIdentifier ?? "Not recorded"} />
            <Field label="Store URL" value={store.storeUrl ?? "Not recorded"} />
            <Field label="Currency" value={store.currency ?? "Not set"} />
            <Field label="Launch target" value={store.launchTargetDate ? formatInTimeZone(store.launchTargetDate, "UTC", { hour: undefined, minute: undefined }) : "Not set"} />
            <Field label="Launched" value={store.launchedAt ? formatInTimeZone(store.launchedAt, "UTC", { hour: undefined, minute: undefined }) : "Not launched"} />
          </div>
        </CardContent>
      </Card>

      {canManage && store.status !== "ARCHIVED" ? (
        <Card>
          <CardContent>
            <form action={handleUpdate} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={launchTargetId}>Launch target date</Label>
                <Input id={launchTargetId} name="launchTargetDate" type="date" defaultValue={store.launchTargetDate ? store.launchTargetDate.toISOString().slice(0, 10) : ""} disabled={pending} />
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
          {store.status === "ARCHIVED" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => reactivateEcommerceStoreAction({ storeId: store.id }))}>
              Reactivate store
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => archiveEcommerceStoreAction({ storeId: store.id }))}>
              Archive store
            </Button>
          )}
        </div>
      ) : null}

      {canLaunch && store.status !== "LIVE" && store.status !== "ARCHIVED" ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium">Record launch</p>
            <p className="text-xs text-muted-foreground">
              Readiness: <span className="font-medium">{readiness.status.replace("_", " ")}</span>
              {readiness.reasons.length > 0 ? ` — ${readiness.reasons.join(" ")}` : ""}
            </p>
            {!showLaunch ? (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setShowLaunch(true)}>
                {readiness.status === "READY" ? "Record launch" : "Record launch (override)"}
              </Button>
            ) : (
              <form action={handleLaunch} className="flex flex-wrap items-end gap-2">
                {readiness.status !== "READY" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={overrideId}>Override reason (required — this store is not launch-ready)</Label>
                    <Input id={overrideId} name="overrideReason" required className="w-80" disabled={pending} />
                  </div>
                ) : (
                  <input type="hidden" name="overrideReason" value="" />
                )}
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Confirm launch
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setShowLaunch(false)}>
                  Cancel
                </Button>
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
