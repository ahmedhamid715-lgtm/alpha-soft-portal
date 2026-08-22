"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { retryInvoicePaymentAction, type RetryPaymentActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const initialState: RetryPaymentActionState = {};

/** Only rendered for an OPEN invoice, owner-only — mirrors `SubscriptionControls`' confirm-dialog pattern. */
export function RetryPaymentButton({ organizationId, invoiceId }: { organizationId: string; invoiceId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(retryInvoicePaymentAction, initialState);
  const [pending, startTransition] = useTransition();

  function submit() {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    formData.set("invoiceId", invoiceId);
    startTransition(() => action(formData));
    setConfirming(false);
  }

  if (state.success) {
    return <span className="text-sm text-muted-foreground">Retry requested.</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {state.error ? (
        <Alert variant="destructive" role="alert" className="max-w-xs">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
        Retry payment
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Retry this payment?"
        description="Attempts to charge the organization's current default payment method for this invoice one more time, immediately."
        confirmLabel="Retry payment"
        loading={pending}
        onConfirm={submit}
      />
    </div>
  );
}
