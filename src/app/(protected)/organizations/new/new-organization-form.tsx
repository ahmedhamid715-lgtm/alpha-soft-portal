"use client";

import { useActionState, useId } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { createOrganizationAction, type CreateOrganizationActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const initialState: CreateOrganizationActionState = {};

/**
 * Organization creation (spec sections 28–30) — platform-staff-only.
 * `slug` is user-editable here (not auto-derived) so the operator can set
 * the exact subdomain-safe value up front; `createOrganization()`
 * independently re-validates and uniqueness-checks it server-side
 * regardless of what this form sends.
 */
export function NewOrganizationForm() {
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);
  const nameId = useId();
  const displayNameId = useId();
  const slugId = useId();
  const ownerEmailId = useId();
  const ownerNameId = useId();

  if (state.created) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2 />
          <AlertTitle>{state.created.displayName} created</AlertTitle>
          <AlertDescription>
            The owner ({state.created.slug}) can sign in and complete onboarding themselves. Platform staff have no
            membership in tenant organizations by design (spec section 33) — this page won&apos;t link you into it.
          </AlertDescription>
        </Alert>
        <Button asChild className="w-fit">
          <Link href="/organizations/new">Create another</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={displayNameId}>Organization name</Label>
        <Input id={displayNameId} name="displayName" required maxLength={200} aria-describedby={state.fieldErrors?.displayName ? `${displayNameId}-error` : undefined} />
        {state.fieldErrors?.displayName ? (
          <p id={`${displayNameId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.displayName[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Legal / internal name</Label>
        <Input id={nameId} name="name" required maxLength={200} aria-describedby={state.fieldErrors?.name ? `${nameId}-error` : `${nameId}-hint`} />
        <p id={`${nameId}-hint`} className="text-sm text-muted-foreground">Used internally — the display name above is what members see.</p>
        {state.fieldErrors?.name ? (
          <p id={`${nameId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={slugId}>Slug</Label>
        <Input id={slugId} name="slug" required minLength={2} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="acme-co" aria-describedby={state.fieldErrors?.slug ? `${slugId}-error` : `${slugId}-hint`} />
        <p id={`${slugId}-hint`} className="text-sm text-muted-foreground">Lowercase, alphanumeric, hyphen-separated. Must be unique.</p>
        {state.fieldErrors?.slug ? (
          <p id={`${slugId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.slug[0]}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">First owner</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ownerNameId}>Owner name</Label>
          <Input id={ownerNameId} name="ownerName" required maxLength={200} aria-describedby={state.fieldErrors?.ownerName ? `${ownerNameId}-error` : undefined} />
          {state.fieldErrors?.ownerName ? (
            <p id={`${ownerNameId}-error`} role="alert" className="text-sm font-medium text-destructive">
              {state.fieldErrors.ownerName[0]}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ownerEmailId}>Owner email</Label>
          <Input id={ownerEmailId} name="ownerEmail" type="email" required aria-describedby={state.fieldErrors?.ownerEmail ? `${ownerEmailId}-error` : `${ownerEmailId}-hint`} />
          <p id={`${ownerEmailId}-hint`} className="text-sm text-muted-foreground">If this email already has an Alpha OS account, that account becomes the owner.</p>
          {state.fieldErrors?.ownerEmail ? (
            <p id={`${ownerEmailId}-error`} role="alert" className="text-sm font-medium text-destructive">
              {state.fieldErrors.ownerEmail[0]}
            </p>
          ) : null}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Create organization
      </Button>
    </form>
  );
}
