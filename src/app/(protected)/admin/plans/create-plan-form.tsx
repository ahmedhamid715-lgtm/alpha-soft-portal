"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { createPlanAction, type PlanActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

const initialState: PlanActionState = {};

export function CreatePlanForm() {
  const [state, formAction, pending] = useActionState(createPlanAction, initialState);
  const keyId = useId();
  const nameId = useId();
  const descriptionId = useId();

  return (
    <Card className="max-w-md">
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          {state.success ? (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>Plan created.</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={keyId}>Key</Label>
            <Input id={keyId} name="key" placeholder="growth" pattern="[a-z][a-z0-9_]*" maxLength={50} required />
            <p className="text-xs text-muted-foreground">Stable internal id — lowercase letters, digits, underscores. Never shown to customers.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Display name</Label>
            <Input id={nameId} name="name" placeholder="Growth" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={2000} rows={2} />
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create plan
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
