"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { cancelSubscriptionAction, resumeSubscriptionAction, type BillingActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const initialState: BillingActionState = {};

/** Cancel (at period end, the default reversible path) / resume — mirrors `LifecycleControls`' own confirm-dialog pattern (settings/lifecycle-controls.tsx). Never an immediate-cancel button here — that's a rarer, more consequential action left to support-assisted flows, not a one-click self-service control (spec §28 leaves this a deliberate choice, not an oversight). */
export function SubscriptionControls({ organizationId, cancelAtPeriodEnd }: { organizationId: string; cancelAtPeriodEnd: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [cancelState, cancelAction] = useActionState(cancelSubscriptionAction, initialState);
  const [resumeState, resumeAction] = useActionState(resumeSubscriptionAction, initialState);
  const [pending, startTransition] = useTransition();

  function submitCancel() {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    formData.set("atPeriodEnd", "true");
    startTransition(() => cancelAction(formData));
    setConfirming(false);
  }

  function submitResume() {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    startTransition(() => resumeAction(formData));
  }

  const error = cancelState.error ?? resumeState.error;

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {cancelAtPeriodEnd ? (
        <Button type="button" variant="outline" onClick={submitResume} disabled={pending}>
          Resume subscription
        </Button>
      ) : (
        <Button type="button" variant="destructive" onClick={() => setConfirming(true)} disabled={pending}>
          Cancel subscription
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this subscription?"
        description="Access continues until the end of the current billing period. You can resume any time before then."
        confirmLabel="Cancel at period end"
        variant="destructive"
        loading={pending}
        onConfirm={submitCancel}
      />
    </div>
  );
}
