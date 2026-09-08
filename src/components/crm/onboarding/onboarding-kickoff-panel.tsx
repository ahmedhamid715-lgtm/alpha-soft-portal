"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleKickoffAction, completeKickoffAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CrmClientOnboarding } from "@/generated/prisma/client";

/** A real onboarding milestone, honestly labeled as an internal record — no calendar integration, no claim that a real meeting invite was ever sent (see the model's own schema comment). */
export function OnboardingKickoffPanel({ onboarding }: { onboarding: CrmClientOnboarding }) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function schedule() {
    if (!scheduledAt) return;
    setError(null);
    startTransition(async () => {
      const result = await scheduleKickoffAction({ onboardingId: onboarding.id, scheduledAt, notes: notes || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function complete() {
    setError(null);
    startTransition(async () => {
      const result = await completeKickoffAction({ onboardingId: onboarding.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (onboarding.kickoffCompletedAt) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-success">Kickoff completed</span>
        <span className="text-muted-foreground">Scheduled for {onboarding.kickoffScheduledAt ? formatInTimeZone(onboarding.kickoffScheduledAt, "UTC") : "—"}, completed {formatInTimeZone(onboarding.kickoffCompletedAt, "UTC")}.</span>
      </div>
    );
  }

  if (onboarding.kickoffScheduledAt) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <span>
          Scheduled for <span className="font-medium">{formatInTimeZone(onboarding.kickoffScheduledAt, "UTC")}</span> (internal record — no calendar invite was sent).
        </span>
        {onboarding.kickoffNotes ? <p className="text-muted-foreground">{onboarding.kickoffNotes}</p> : null}
        <Button size="sm" className="w-fit" disabled={pending} onClick={complete}>
          Mark kickoff complete
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Internal record only — this does not create a calendar invite or send a meeting link.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kickoff-date">Scheduled for</Label>
        <Input id="kickoff-date" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kickoff-notes">Notes (optional)</Label>
        <Textarea id="kickoff-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} disabled={pending} />
      </div>
      <Button size="sm" className="w-fit" disabled={pending || !scheduledAt} onClick={schedule}>
        Schedule kickoff
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
