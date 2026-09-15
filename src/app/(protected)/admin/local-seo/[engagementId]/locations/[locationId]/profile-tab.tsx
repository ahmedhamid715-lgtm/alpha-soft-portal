"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { recordGbpProfileAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import type { GbpProfile } from "@/generated/prisma/client";

const VERIFICATION_TONE: Record<string, "success" | "warning" | "neutral"> = { VERIFIED: "success", UNVERIFIED: "warning", NOT_MEASURED: "neutral" };

/**
 * The Google Business Profile identity for this location (Build 31 —
 * Roadmap Module 25). Staff RECORD what they observed — this never
 * calls a live Google API (no provider integration exists). `verified`
 * only ever reflects an explicit input value, never a default.
 */
export function ProfileTab({ locationId, initialProfile, canManage }: { locationId: string; initialProfile: GbpProfile | null; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialProfile === null);
  const router = useRouter();
  const externalIdId = useId();
  const profileUrlId = useId();
  const categoryId = useId();
  const verificationId = useId();
  const observedStatusId = useId();

  function handleSubmit(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    startTransition(async () => {
      const result = await recordGbpProfileAction({
        locationId,
        externalProfileId: str("externalProfileId"),
        profileUrl: str("profileUrl"),
        primaryCategory: str("primaryCategory"),
        verificationState: formData.get("verificationState") ?? "NOT_MEASURED",
        observedStatus: str("observedStatus"),
      });
      setError(result.error ?? null);
      if (!result.error) {
        setEditing(false);
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

      {!editing && initialProfile ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{initialProfile.primaryCategory ?? "No category on file"}</span>
              <StatusBadge status={VERIFICATION_TONE[initialProfile.verificationState]}>{initialProfile.verificationState.replace("_", " ")}</StatusBadge>
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              {initialProfile.profileUrl ? (
                <a href={initialProfile.profileUrl} target="_blank" rel="noreferrer" className="text-link underline underline-offset-4">
                  {initialProfile.profileUrl}
                </a>
              ) : (
                <span>No profile URL on file</span>
              )}
              {initialProfile.observedStatus ? <span>Observed status: {initialProfile.observedStatus}</span> : null}
              {initialProfile.lastObservedAt ? <span>Last observed {initialProfile.lastObservedAt.toISOString().slice(0, 10)}</span> : <span>Never observed</span>}
            </div>
            {canManage ? (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setEditing(true)}>
                Update
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!initialProfile && !canManage ? <p className="text-sm text-muted-foreground">No Google Business Profile data recorded yet.</p> : null}

      {editing && canManage ? (
        <Card>
          <CardContent>
            <form action={handleSubmit} className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Record what you observed on Google — this never publishes or syncs anything (no live provider integration exists).</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={externalIdId}>Google profile/location ID (optional)</Label>
                  <Input id={externalIdId} name="externalProfileId" defaultValue={initialProfile?.externalProfileId ?? ""} disabled={pending} className="w-56" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={profileUrlId}>Profile URL (optional)</Label>
                  <Input id={profileUrlId} name="profileUrl" type="url" defaultValue={initialProfile?.profileUrl ?? ""} disabled={pending} className="w-64" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={categoryId}>Primary category (optional)</Label>
                  <Input id={categoryId} name="primaryCategory" defaultValue={initialProfile?.primaryCategory ?? ""} disabled={pending} className="w-48" />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={verificationId}>Verification state (as observed)</Label>
                  <select id={verificationId} name="verificationState" defaultValue={initialProfile?.verificationState ?? "NOT_MEASURED"} disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                    <option value="NOT_MEASURED">Not measured</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="UNVERIFIED">Unverified</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={observedStatusId}>Observed status (optional)</Label>
                  <Input id={observedStatusId} name="observedStatus" defaultValue={initialProfile?.observedStatus ?? ""} disabled={pending} className="w-48" />
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Save
                </Button>
                {initialProfile ? (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
