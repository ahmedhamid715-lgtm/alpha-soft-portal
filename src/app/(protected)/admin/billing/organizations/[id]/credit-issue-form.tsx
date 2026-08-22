"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { issueCreditAction, type CreditActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: CreditActionState = {};

/**
 * Platform-staff-only credit issuance (spec §6/§11) — mirrors
 * `RefundButton`'s own "one deliberate mutation, plainly labeled, server
 * enforces the real permission" shape. No confirm dialog: unlike a
 * refund, a credit is reversible (`adjustCredit()` exists precisely for
 * that) and moves no real money, so a lighter-weight form is
 * appropriate here — see `permissions.ts`'s own reasoning for why this
 * is a DIFFERENT risk tier than `billing.refund`.
 */
export function CreditIssueForm({ organizationId, currency }: { organizationId: string; currency: string }) {
  const [state, action, pending] = useActionState(issueCreditAction, initialState);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="currency" value={currency} />
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? <p className="text-sm text-success">Credit issued.</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="credit-amount">Amount ({currency})</Label>
          <Input id="credit-amount" name="amount" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="credit-reason">Reason</Label>
          <Input id="credit-reason" name="reason" type="text" maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <Button type="submit" variant="outline" className="w-fit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Issue credit
      </Button>
    </form>
  );
}
