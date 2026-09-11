"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Globe } from "lucide-react";
import { createSeoPropertyAction, archiveSeoPropertyAction, reactivateSeoPropertyAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { SEO_FRESHNESS_LABELS } from "@/lib/seo/freshness";
import type { SeoEngagementDetail } from "@/server/services/seo-engagement-service";

const PROPERTY_STATUS_TONE: Record<string, "success" | "neutral"> = { ACTIVE: "success", ARCHIVED: "neutral" };

export function EngagementWorkspace({ detail, canManage, canManageMeasurements }: { detail: SeoEngagementDetail; canManage: boolean; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const router = useRouter();
  const urlId = useId();
  const countryId = useId();

  function runAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  function handleAddProperty(formData: FormData) {
    const url = formData.get("url");
    const targetCountry = formData.get("targetCountry");
    runAction(async () => {
      const result = await createSeoPropertyAction({
        engagementId: detail.engagement.id,
        url: typeof url === "string" ? url : "",
        targetCountry: typeof targetCountry === "string" && targetCountry.length > 0 ? targetCountry : null,
      });
      if (!result.error) setShowAddProperty(false);
      return result;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between">
        <SectionHeader title="Properties" />
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setShowAddProperty((v) => !v)}>
            Add property
          </Button>
        ) : null}
      </div>

      {showAddProperty ? (
        <Card>
          <CardContent>
            <form action={handleAddProperty} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={urlId}>Website URL</Label>
                <Input id={urlId} name="url" type="url" placeholder="https://example.com" required disabled={pending} className="w-72" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={countryId}>Target country (optional)</Label>
                <Input id={countryId} name="targetCountry" placeholder="US" maxLength={2} disabled={pending} className="w-24" />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {detail.properties.length === 0 ? (
        <EmptyState icon={Globe} title="No properties tracked yet" description="Add a website to start tracking keywords and technical issues." />
      ) : (
        <div className="flex flex-col gap-2">
          {detail.properties.map(({ property, keywordCount, freshness, openIssueCount }) => (
            <Card key={property.id}>
              <CardContent className="flex items-center justify-between gap-4">
                <Link href={`/admin/seo/${detail.engagement.id}/properties/${property.id}`} className="flex flex-col hover:underline">
                  <span className="text-sm font-medium">{property.displayUrl}</span>
                  <span className="text-xs text-muted-foreground">
                    {keywordCount} keyword(s) · {SEO_FRESHNESS_LABELS[freshness]}
                    {openIssueCount > 0 ? ` · ${openIssueCount} open issue(s)` : ""}
                  </span>
                </Link>
                <div className="flex items-center gap-2">
                  <StatusBadge status={PROPERTY_STATUS_TONE[property.status]}>{property.status}</StatusBadge>
                  {canManage ? (
                    property.status === "ACTIVE" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => archiveSeoPropertyAction({ propertyId: property.id }))}>
                        Archive
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => reactivateSeoPropertyAction({ propertyId: property.id }))}>
                        Reactivate
                      </Button>
                    )
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!canManageMeasurements && !canManage ? <p className="text-xs text-muted-foreground">Recording measurements requires the seo.measurements.manage permission.</p> : null}
    </div>
  );
}
