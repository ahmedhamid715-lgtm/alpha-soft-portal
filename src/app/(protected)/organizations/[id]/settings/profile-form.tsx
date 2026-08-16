"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { updateProfileAction, type SettingsActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: SettingsActionState = {};

export function OrganizationProfileForm({
  organizationId,
  organization,
  disabled,
}: {
  organizationId: string;
  organization: { displayName: string; industry: string | null; website: string | null; country: string | null; phone: string | null; primaryEmail: string | null };
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialState);
  const displayNameId = useId();
  const industryId = useId();
  const websiteId = useId();
  const countryId = useId();
  const phoneId = useId();
  const emailId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
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
          <AlertDescription>Profile updated.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={displayNameId}>Display name</Label>
        <Input id={displayNameId} name="displayName" defaultValue={organization.displayName} disabled={disabled} maxLength={200} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={industryId}>Industry</Label>
          <Input id={industryId} name="industry" defaultValue={organization.industry ?? ""} disabled={disabled} maxLength={100} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={websiteId}>Website</Label>
          <Input id={websiteId} name="website" type="url" defaultValue={organization.website ?? ""} disabled={disabled} placeholder="https://" />
          {state.fieldErrors?.website ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.fieldErrors.website[0]}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={countryId}>Country code</Label>
          <Input id={countryId} name="country" defaultValue={organization.country ?? ""} disabled={disabled} maxLength={2} placeholder="US" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={phoneId}>Phone</Label>
          <Input id={phoneId} name="phone" defaultValue={organization.phone ?? ""} disabled={disabled} maxLength={30} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Primary contact email</Label>
        <Input id={emailId} name="primaryEmail" type="email" defaultValue={organization.primaryEmail ?? ""} disabled={disabled} />
        {state.fieldErrors?.primaryEmail ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.primaryEmail[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={disabled || pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save changes
      </Button>
    </form>
  );
}
