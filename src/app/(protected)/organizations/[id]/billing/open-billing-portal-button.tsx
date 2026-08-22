"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { openBillingPortalAction, type BillingActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: BillingActionState = {};

/** Redirects to the Stripe-hosted Billing Portal (spec §25/§51) — payment method, invoice history, billing details. Alpha OS never builds its own card-entry form. */
export function OpenBillingPortalButton({ organizationId, disabled }: { organizationId: string; disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(openBillingPortalAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={disabled || pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Manage payment method
      </Button>
    </form>
  );
}
