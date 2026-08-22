"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { startCheckoutAction, type BillingActionState } from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils/money";

const initialState: BillingActionState = {};

interface PlanPickerPlan {
  id: string;
  name: string;
  description: string | null;
  prices: Array<{ id: string; unitAmount: number; currency: string; interval: "MONTH" | "YEAR" }>;
}

/**
 * The active plan catalog (spec §6/§25) — every price shown is a real
 * `PlanPrice` row; nothing here is hardcoded plan copy. Submitting only
 * ever sends `planPriceId` — the server independently resolves the real
 * amount/currency/provider price (spec §26/§43); this form has no
 * amount field to forge in the first place.
 */
export function PlanPicker({ organizationId, plans }: { organizationId: string; plans: PlanPickerPlan[] }) {
  const [state, formAction, pending] = useActionState(startCheckoutAction, initialState);

  if (plans.length === 0) {
    return <p className="text-sm text-muted-foreground">No plans are currently available. Contact Alpha Page Rankers to get started.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardContent className="flex flex-col gap-3">
              <div>
                <p className="font-medium">{plan.name}</p>
                {plan.description ? <p className="text-sm text-muted-foreground">{plan.description}</p> : null}
              </div>
              <div className="flex flex-col gap-2">
                {plan.prices.map((price) => (
                  <form key={price.id} action={formAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="planPriceId" value={price.id} />
                    <Button type="submit" variant="outline" className="w-full justify-between" disabled={pending}>
                      <span>{formatMoney(price.unitAmount, price.currency)} / {price.interval === "YEAR" ? "year" : "month"}</span>
                      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                    </Button>
                  </form>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
