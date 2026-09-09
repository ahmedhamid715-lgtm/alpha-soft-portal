"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { updatePortalCompanyProfileAction, type PortalCompanyActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: PortalCompanyActionState = {};

export function CompanyProfileForm({ organizationId, organization }: { organizationId: string; organization: { displayName: string; website: string | null; industry: string | null; country: string | null; phone: string | null; primaryEmail: string | null } }) {
  const [state, formAction, pending] = useActionState(updatePortalCompanyProfileAction, initialState);
  const displayNameId = useId();
  const websiteId = useId();
  const industryId = useId();
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
        <Alert role="status">
          <CheckCircle2 />
          <AlertDescription>Company profile updated.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={displayNameId}>Company name</Label>
        <Input id={displayNameId} name="displayName" defaultValue={organization.displayName} required maxLength={200} disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={websiteId}>Website</Label>
        <Input id={websiteId} name="website" type="url" defaultValue={organization.website ?? ""} placeholder="https://example.com" disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={industryId}>Industry</Label>
        <Input id={industryId} name="industry" defaultValue={organization.industry ?? ""} maxLength={100} disabled={pending} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={countryId}>Country (2-letter code)</Label>
          <Input id={countryId} name="country" defaultValue={organization.country ?? ""} maxLength={2} placeholder="US" disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={phoneId}>Phone</Label>
          <Input id={phoneId} name="phone" defaultValue={organization.phone ?? ""} maxLength={30} disabled={pending} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Primary contact email</Label>
        <Input id={emailId} name="primaryEmail" type="email" defaultValue={organization.primaryEmail ?? ""} disabled={pending} />
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        Save
      </Button>
    </form>
  );
}
