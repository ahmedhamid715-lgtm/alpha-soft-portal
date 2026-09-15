"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateWebsiteSiteAction, archiveWebsiteSiteAction, reactivateWebsiteSiteAction, recordWebsiteLaunchAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { WEBSITE_SITE_TYPE_LABELS, WEBSITE_PLATFORM_LABELS } from "@/components/website-dev/website-status";
import type { WebsiteSiteOverview } from "@/server/services/website-engagement-service";
import type { WebsiteConfigurationState } from "@/generated/prisma/client";

/**
 * Site overview (Build 32 — Roadmap Module 26). `recordWebsiteLaunch()`
 * is the ONLY path that ever sets a site's status to LAUNCHED — this
 * form never infers a launch from a production URL/environment merely
 * existing. Saving a deployment or environment row here is EVIDENCE,
 * never a claim that Alpha OS itself performed a hosting/DNS/deployment
 * action.
 */
export function OverviewTab({ overview, canManage, canDeploy }: { overview: WebsiteSiteOverview; canManage: boolean; canDeploy: boolean }) {
  const { site, readiness } = overview;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const router = useRouter();
  const launchTargetId = useId();
  const analyticsId = useId();
  const tagManagerId = useId();
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
    const analyticsConfigured = formData.get("analyticsConfigured");
    const tagManagerConfigured = formData.get("tagManagerConfigured");
    runAction(() =>
      updateWebsiteSiteAction({
        siteId: site.id,
        launchTargetDate: typeof launchTargetDate === "string" && launchTargetDate.length > 0 ? `${launchTargetDate}T00:00:00.000Z` : null,
        analyticsConfigured: typeof analyticsConfigured === "string" ? (analyticsConfigured as WebsiteConfigurationState) : undefined,
        tagManagerConfigured: typeof tagManagerConfigured === "string" ? (tagManagerConfigured as WebsiteConfigurationState) : undefined,
      }),
    );
  }

  function handleLaunch(formData: FormData) {
    const overrideReason = formData.get("overrideReason");
    runAction(
      () => recordWebsiteLaunchAction({ siteId: site.id, overrideReason: typeof overrideReason === "string" && overrideReason.trim().length > 0 ? overrideReason.trim() : null }),
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
            <Field label="Site type" value={WEBSITE_SITE_TYPE_LABELS[site.siteType]} />
            <Field label="Platform" value={WEBSITE_PLATFORM_LABELS[site.platform]} />
            <Field label="Primary URL" value={site.primaryUrl ?? "Not recorded"} />
            <Field label="Launch target" value={site.launchTargetDate ? formatInTimeZone(site.launchTargetDate, "UTC", { hour: undefined, minute: undefined }) : "Not set"} />
            <Field label="Launched" value={site.launchedAt ? formatInTimeZone(site.launchedAt, "UTC", { hour: undefined, minute: undefined }) : "Not launched"} />
            <Field label="Analytics configured" value={site.analyticsConfigured} />
            <Field label="Tag Manager configured" value={site.tagManagerConfigured} />
            {site.repositoryUrl ? <Field label="Repository (reference only)" value={site.repositoryUrl} /> : null}
          </div>
          {site.technologyNotes ? <p className="text-xs text-muted-foreground">{site.technologyNotes}</p> : null}
        </CardContent>
      </Card>

      {canManage && site.status !== "ARCHIVED" ? (
        <Card>
          <CardContent>
            <form action={handleUpdate} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={launchTargetId}>Launch target date</Label>
                <Input id={launchTargetId} name="launchTargetDate" type="date" defaultValue={site.launchTargetDate ? site.launchTargetDate.toISOString().slice(0, 10) : ""} disabled={pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={analyticsId}>Analytics configured</Label>
                <Select name="analyticsConfigured" defaultValue={site.analyticsConfigured} disabled={pending}>
                  <SelectTrigger id={analyticsId} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                    <SelectItem value="UNKNOWN">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={tagManagerId}>Tag Manager configured</Label>
                <Select name="tagManagerConfigured" defaultValue={site.tagManagerConfigured} disabled={pending}>
                  <SelectTrigger id={tagManagerId} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                    <SelectItem value="UNKNOWN">Unknown</SelectItem>
                  </SelectContent>
                </Select>
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
          {site.status === "ARCHIVED" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => reactivateWebsiteSiteAction({ siteId: site.id }))}>
              Reactivate site
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => archiveWebsiteSiteAction({ siteId: site.id }))}>
              Archive site
            </Button>
          )}
        </div>
      ) : null}

      {canDeploy && site.status !== "LAUNCHED" && site.status !== "ARCHIVED" ? (
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
                    <Label htmlFor={overrideId}>Override reason (required — this site is not launch-ready)</Label>
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
