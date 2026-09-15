"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, ListChecks } from "lucide-react";
import { recordLocalListingAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { evaluateNapConsistency, type NapConsistencyStatus } from "@/lib/local-seo/nap";
import type { LocalListing } from "@/generated/prisma/client";

const CONSISTENCY_TONE: Record<NapConsistencyStatus, "success" | "destructive" | "warning" | "neutral"> = { CONSISTENT: "success", INCONSISTENT: "destructive", PARTIAL: "warning", NOT_MEASURABLE: "neutral" };
const CONSISTENCY_LABEL: Record<NapConsistencyStatus, string> = { CONSISTENT: "NAP consistent", INCONSISTENT: "NAP inconsistent", PARTIAL: "Partially comparable", NOT_MEASURABLE: "Not measurable" };

interface CanonicalLocation {
  businessName: string;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
}

/**
 * Listings/citations on external directories (Build 31 — Roadmap Module
 * 25). NAP consistency is computed LIVE, in the browser, from the same
 * pure `evaluateNapConsistency()` function the server uses — never
 * stored/denormalized (see that function's own doc comment).
 */
export function ListingsTab({ locationId, initialItems, canonical, canManageMeasurements }: { locationId: string; initialItems: LocalListing[]; canonical: CanonicalLocation; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();
  const sourceNameId = useId();
  const sourceUrlId = useId();
  const nameId = useId();
  const addressId = useId();
  const cityId = useId();
  const postalId = useId();
  const phoneId = useId();

  function handleSubmit(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    startTransition(async () => {
      const result = await recordLocalListingAction({
        locationId,
        sourceName: str("sourceName") ?? "",
        sourceUrl: str("sourceUrl"),
        observedBusinessName: str("observedBusinessName"),
        observedAddressLine1: str("observedAddressLine1"),
        observedCity: str("observedCity"),
        observedPostalCode: str("observedPostalCode"),
        observedPhone: str("observedPhone"),
        observedAt: new Date().toISOString(),
      });
      setError(result.error ?? null);
      if (!result.error) {
        setShowAdd(false);
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
            Record listing
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleSubmit} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Enter exactly what you observed on this directory — never adjusted to match your canonical location data.</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={sourceNameId}>Directory name</Label>
                  <Input id={sourceNameId} name="sourceName" placeholder="Yelp" required disabled={pending} className="w-40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={sourceUrlId}>Listing URL (optional)</Label>
                  <Input id={sourceUrlId} name="sourceUrl" type="url" disabled={pending} className="w-64" />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={nameId}>Observed business name</Label>
                  <Input id={nameId} name="observedBusinessName" disabled={pending} className="w-56" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={addressId}>Observed address</Label>
                  <Input id={addressId} name="observedAddressLine1" disabled={pending} className="w-56" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={cityId}>Observed city</Label>
                  <Input id={cityId} name="observedCity" disabled={pending} className="w-40" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={postalId}>Observed postal code</Label>
                  <Input id={postalId} name="observedPostalCode" disabled={pending} className="w-28" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={phoneId}>Observed phone</Label>
                  <Input id={phoneId} name="observedPhone" disabled={pending} className="w-40" />
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={ListChecks} title="No listings recorded yet" description="Record what you observe on external directories to track NAP consistency." />
      ) : (
        <div className="flex flex-col gap-2">
          {initialItems.map((listing) => {
            const status = evaluateNapConsistency(
              { businessName: canonical.businessName, addressLine1: canonical.addressLine1, city: canonical.city, postalCode: canonical.postalCode, phone: canonical.phone },
              { observedBusinessName: listing.observedBusinessName, observedAddressLine1: listing.observedAddressLine1, observedCity: listing.observedCity, observedPostalCode: listing.observedPostalCode, observedPhone: listing.observedPhone },
            );
            return (
              <Card key={listing.id}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{listing.sourceName}</span>
                    <StatusBadge status={CONSISTENCY_TONE[status]}>{CONSISTENCY_LABEL[status]}</StatusBadge>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    {listing.observedBusinessName ? <span>{listing.observedBusinessName}</span> : null}
                    {listing.observedAddressLine1 || listing.observedCity ? (
                      <span>
                        {listing.observedAddressLine1}
                        {listing.observedAddressLine1 && listing.observedCity ? ", " : ""}
                        {listing.observedCity} {listing.observedPostalCode ?? ""}
                      </span>
                    ) : null}
                    {listing.observedPhone ? <span>{listing.observedPhone}</span> : null}
                    <span>Observed {listing.observedAt.toISOString().slice(0, 10)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
