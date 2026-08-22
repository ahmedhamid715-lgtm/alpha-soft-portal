"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { extendTrialAction, type TrialActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: TrialActionState = {};

/** Only rendered while the subscription is TRIALING (spec §6/§16) — `extendTrial()` itself independently re-validates that server-side regardless. */
export function TrialExtendForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(extendTrialAction, initialState);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? <p className="text-sm text-success">Trial extended.</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trial-days">Additional days</Label>
          <Input id="trial-days" name="additionalDays" type="number" step="1" min="1" max="90" required value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trial-reason">Reason</Label>
          <Input id="trial-reason" name="reason" type="text" maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <Button type="submit" variant="outline" className="w-fit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Extend trial
      </Button>
    </form>
  );
}
