"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOnboardingStatusAction, cancelOnboardingAction, completeOnboardingAction, forceCompleteOnboardingAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmClientOnboarding } from "@/generated/prisma/client";

/**
 * `crm.onboarding.manage` for ordinary status/cancel/complete;
 * `crm.onboarding.complete` (a separate permission — see permissions.ts's
 * own comment) additionally required for the force-complete override,
 * gated by the `canForceComplete` prop the page itself resolves from
 * the caller's real permission set.
 */
export function OnboardingLifecycleControls({ onboarding, canComplete, canForceComplete }: { onboarding: CrmClientOnboarding; canComplete: boolean; canForceComplete: boolean }) {
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [showForceForm, setShowForceForm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function runAction(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowCancelForm(false);
      setShowForceForm(false);
      setReason("");
      router.refresh();
    });
  }

  if (onboarding.status === "COMPLETED" || onboarding.status === "CANCELLED") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          This onboarding is {onboarding.status === "COMPLETED" ? "complete" : "cancelled"} — a terminal state. Start a new onboarding from the deal if this engagement needs to resume.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboarding-status">Status</Label>
        <Select value={onboarding.status} onValueChange={(v) => runAction(() => setOnboardingStatusAction({ onboardingId: onboarding.id, status: v }))} disabled={pending}>
          <SelectTrigger id="onboarding-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NOT_STARTED">Not started</SelectItem>
            <SelectItem value="IN_PROGRESS">In progress</SelectItem>
            <SelectItem value="BLOCKED">Blocked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        {canComplete ? (
          <Button size="sm" disabled={pending} onClick={() => runAction(() => completeOnboardingAction({ onboardingId: onboarding.id }))}>
            Complete onboarding
          </Button>
        ) : null}
        {canForceComplete ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowForceForm(true)}>
            Force complete
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowCancelForm(true)}>
          Cancel
        </Button>
      </div>

      {showForceForm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <p className="text-sm font-medium">Force complete despite incomplete required work</p>
          <Label htmlFor="force-complete-reason">Reason (required, always audited)</Label>
          <Textarea id="force-complete-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} disabled={pending} />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending || !reason.trim()} onClick={() => runAction(() => forceCompleteOnboardingAction({ onboardingId: onboarding.id, reason }))}>
              Confirm force complete
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowForceForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {showCancelForm ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="cancel-reason">Cancellation reason</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} disabled={pending} />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => runAction(() => cancelOnboardingAction({ onboardingId: onboarding.id, reason }))}>
              Confirm cancellation
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowCancelForm(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
