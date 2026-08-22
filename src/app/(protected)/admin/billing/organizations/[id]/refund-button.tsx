"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { issueRefundAction, type RefundActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatMoney } from "@/lib/utils/money";

const initialState: RefundActionState = {};

/** One-click FULL refund with a confirm dialog — the platform admin billing surface's only mutation (spec §22: `billing.refund`, platform_owner-only, enforced server-side; this button simply doesn't render for anyone else — see the page's own `canRefund` gate). */
export function RefundButton({ organizationId, paymentId, amount, currency }: { organizationId: string; paymentId: string; amount: number; currency: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(issueRefundAction, initialState);
  const [pending, startTransition] = useTransition();

  function submit() {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    formData.set("paymentId", paymentId);
    startTransition(() => action(formData));
    setConfirming(false);
  }

  if (state.success) {
    return <span className="text-sm text-muted-foreground">Refunded</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {state.error ? (
        <Alert variant="destructive" role="alert" className="max-w-xs">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
        Refund
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Issue a full refund?"
        description={`This refunds ${formatMoney(amount, currency)} to the customer's original payment method. This cannot be undone from this screen.`}
        confirmLabel="Refund"
        variant="destructive"
        loading={pending}
        onConfirm={submit}
      />
    </div>
  );
}
