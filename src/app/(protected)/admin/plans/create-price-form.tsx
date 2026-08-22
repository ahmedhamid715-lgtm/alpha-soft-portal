"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { createPlanPriceAction, type PlanActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: PlanActionState = {};

/** Money entered as a major-unit decimal (e.g. "199.00") — converted to minor units server-side (`toMinorUnits`, spec §7's own boundary), never sent as minor units from this form. */
export function CreatePriceForm({ planId }: { planId: string }) {
  const [state, formAction, pending] = useActionState(createPlanPriceAction, initialState);
  const amountId = useId();
  const currencyId = useId();
  const intervalId = useId();
  const providerPriceId = useId();

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="planId" value={planId} />
      {state.error ? (
        <Alert variant="destructive" role="alert" className="w-full">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <Alert className="w-full">
          <CheckCircle2 />
          <AlertDescription>Price added.</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1">
        <Label htmlFor={amountId} className="text-xs">Amount</Label>
        <Input id={amountId} name="unitAmountMajor" type="number" min={0} step="0.01" placeholder="199.00" required className="w-28" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={currencyId} className="text-xs">Currency</Label>
        <Input id={currencyId} name="currency" defaultValue="USD" maxLength={3} required className="w-20" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={intervalId} className="text-xs">Interval</Label>
        <select id={intervalId} name="interval" defaultValue="MONTH" className="h-9 rounded-md border border-border bg-background px-2.5 text-sm">
          <option value="MONTH">Monthly</option>
          <option value="YEAR">Annual</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={providerPriceId} className="text-xs">Stripe price id (optional)</Label>
        <Input id={providerPriceId} name="providerPriceId" placeholder="price_..." className="w-40" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Add price
      </Button>
    </form>
  );
}
