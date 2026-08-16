"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { advanceOnboardingAction, onboardingQuickInviteAction, type OnboardingActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const initialState: OnboardingActionState = {};

export function ContinueOnboardingButton({ organizationId, label = "Continue" }: { organizationId: string; label?: string }) {
  const [state, formAction, pending] = useActionState(advanceOnboardingAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {label}
      </Button>
    </form>
  );
}

export function OnboardingInviteStep({
  organizationId,
  roleOptions,
}: {
  organizationId: string;
  roleOptions: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(onboardingQuickInviteAction, initialState);
  const emailId = useId();
  const roleId = useId();

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="organizationId" value={organizationId} />
        {state.error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        {state.success ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>Invitation sent.</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={emailId}>Teammate&apos;s email</Label>
          <Input id={emailId} name="email" type="email" required aria-describedby={state.fieldErrors?.email ? `${emailId}-error` : undefined} />
          {state.fieldErrors?.email ? (
            <p id={`${emailId}-error`} role="alert" className="text-sm font-medium text-destructive">
              {state.fieldErrors.email[0]}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={roleId}>Role</Label>
          <Select name="roleId">
            <SelectTrigger id={roleId} className="w-full">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={pending} variant="outline" className="w-fit">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Send invitation
        </Button>
      </form>
      <ContinueOnboardingButton organizationId={organizationId} label="Continue" />
    </div>
  );
}

export function OnboardingCompleteStep({ organizationId }: { organizationId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <CheckCircle2 />
        <AlertDescription>Setup is ready to finish.</AlertDescription>
      </Alert>
      <ContinueOnboardingButton organizationId={organizationId} label="Finish setup" />
      <Button asChild variant="ghost" className="w-fit">
        <Link href={`/organizations/${organizationId}`}>Skip to organization</Link>
      </Button>
    </div>
  );
}
