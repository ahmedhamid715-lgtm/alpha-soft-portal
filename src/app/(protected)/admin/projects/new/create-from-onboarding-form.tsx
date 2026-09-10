"use client";

import { useActionState, useId, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createProjectFromOnboardingAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

export interface EligibleOnboarding {
  id: string;
  companyName: string;
}

const initialState: ProjectActionState = {};

/**
 * Onboarding -> project handoff — see `project-service.ts`'s own
 * `createProjectFromOnboarding()` doc comment for the idempotency
 * guarantee. This form always creates the "whole onboarding" project
 * (`sourceServiceItemId` omitted) — the one-project-per-sold-service-line
 * path remains fully supported at the service layer for a future UI
 * pass (see docs/architecture/project-management.md "Known
 * limitations"), deliberately not exposed here to keep this first
 * operational workflow simple.
 */
export function CreateFromOnboardingForm({ onboardings }: { onboardings: EligibleOnboarding[] }) {
  const [state, formAction, pending] = useActionState(createProjectFromOnboardingAction, initialState);
  const [onboardingId, setOnboardingId] = useState(onboardings[0]?.id ?? "");
  const onboardingIdInputId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const targetEndDateId = useId();

  if (onboardings.length === 0) {
    return <p className="text-sm text-muted-foreground">No COMPLETED onboarding engagements are available to hand off yet.</p>;
  }

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={onboardingIdInputId}>Completed onboarding</Label>
            <select id={onboardingIdInputId} name="onboardingId" value={onboardingId} onChange={(e) => setOnboardingId(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" required>
              {onboardings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.companyName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} name="title" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={5000} rows={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={targetEndDateId}>Target end date</Label>
            <Input id={targetEndDateId} name="targetEndDate" type="date" />
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create project from onboarding
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
