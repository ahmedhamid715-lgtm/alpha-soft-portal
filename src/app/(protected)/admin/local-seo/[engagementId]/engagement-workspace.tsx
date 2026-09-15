"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, MapPin } from "lucide-react";
import { createLocalSeoLocationAction, archiveLocalSeoLocationAction, reactivateLocalSeoLocationAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { SEO_FRESHNESS_LABELS } from "@/lib/seo/freshness";
import type { LocalSeoEngagementDetail } from "@/server/services/local-seo-engagement-service";

const LOCATION_STATUS_TONE: Record<string, "success" | "neutral"> = { ACTIVE: "success", ARCHIVED: "neutral" };

export function EngagementWorkspace({ detail, canManage, canManageMeasurements }: { detail: LocalSeoEngagementDetail; canManage: boolean; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const router = useRouter();
  const nameId = useId();
  const addressId = useId();
  const cityId = useId();
  const regionId = useId();
  const postalId = useId();
  const countryId = useId();
  const phoneId = useId();
  const websiteId = useId();
  const sabId = useId();

  function runAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  function handleAddLocation(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(async () => {
      const result = await createLocalSeoLocationAction({
        engagementId: detail.engagement.id,
        businessName: str("businessName") ?? "",
        addressLine1: str("addressLine1"),
        city: str("city"),
        region: str("region"),
        postalCode: str("postalCode"),
        country: str("country"),
        phone: str("phone"),
        websiteUrl: str("websiteUrl"),
        serviceAreaBusiness: formData.get("serviceAreaBusiness") === "on",
      });
      if (!result.error) setShowAddLocation(false);
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
        <SectionHeader title="Locations" />
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setShowAddLocation((v) => !v)}>
            Add location
          </Button>
        ) : null}
      </div>

      {showAddLocation ? (
        <Card>
          <CardContent>
            <form action={handleAddLocation} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={nameId}>Business name</Label>
                  <Input id={nameId} name="businessName" required disabled={pending} className="w-64" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={addressId}>Address line 1</Label>
                  <Input id={addressId} name="addressLine1" disabled={pending} className="w-64" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={cityId}>City</Label>
                  <Input id={cityId} name="city" disabled={pending} className="w-40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={regionId}>Region/state</Label>
                  <Input id={regionId} name="region" disabled={pending} className="w-32" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={postalId}>Postal code</Label>
                  <Input id={postalId} name="postalCode" disabled={pending} className="w-28" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={countryId}>Country</Label>
                  <Input id={countryId} name="country" placeholder="US" maxLength={2} disabled={pending} className="w-20" />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={phoneId}>Phone</Label>
                  <Input id={phoneId} name="phone" disabled={pending} className="w-44" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={websiteId}>Website URL</Label>
                  <Input id={websiteId} name="websiteUrl" type="url" placeholder="https://example.com" disabled={pending} className="w-64" />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox id={sabId} name="serviceAreaBusiness" disabled={pending} />
                  <Label htmlFor={sabId} className="font-normal">
                    Service area business (no public address)
                  </Label>
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Add
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {detail.locations.length === 0 ? (
        <EmptyState icon={MapPin} title="No locations tracked yet" description="Add a business location to start tracking Google Business Profile data, local rankings, and listings." />
      ) : (
        <div className="flex flex-col gap-2">
          {detail.locations.map(({ location, keywordCount, freshness, openIssueCount, listingCount }) => (
            <Card key={location.id}>
              <CardContent className="flex items-center justify-between gap-4">
                <Link href={`/admin/local-seo/${detail.engagement.id}/locations/${location.id}`} className="flex flex-col hover:underline">
                  <span className="text-sm font-medium">{location.businessName}</span>
                  <span className="text-xs text-muted-foreground">
                    {location.city ?? (location.serviceAreaBusiness ? "Service area business" : "No address on file")} · {keywordCount} keyword(s) · {listingCount} listing(s) · {SEO_FRESHNESS_LABELS[freshness]}
                    {openIssueCount > 0 ? ` · ${openIssueCount} open issue(s)` : ""}
                  </span>
                </Link>
                <div className="flex items-center gap-2">
                  <StatusBadge status={LOCATION_STATUS_TONE[location.status]}>{location.status}</StatusBadge>
                  {canManage ? (
                    location.status === "ACTIVE" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => archiveLocalSeoLocationAction({ locationId: location.id }))}>
                        Archive
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => reactivateLocalSeoLocationAction({ locationId: location.id }))}>
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
      {!canManageMeasurements && !canManage ? <p className="text-xs text-muted-foreground">Recording measurements requires the local_seo.measurements.manage permission.</p> : null}
    </div>
  );
}
