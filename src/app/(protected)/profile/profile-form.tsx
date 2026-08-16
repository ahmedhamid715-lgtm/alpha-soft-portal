"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { updateProfileAction, type ProfileActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ProfileActionState = {};

export function ProfileForm({ user }: { user: { name: string; timezone: string | null; locale: string | null; avatarUrl: string | null } }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialState);
  const nameId = useId();
  const timezoneId = useId();
  const localeId = useId();
  const avatarId = useId();

  return (
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
          <AlertDescription>Profile updated.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input id={nameId} name="name" required maxLength={200} defaultValue={user.name} aria-describedby={state.fieldErrors?.name ? `${nameId}-error` : undefined} />
        {state.fieldErrors?.name ? (
          <p id={`${nameId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.name[0]}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={timezoneId}>Timezone</Label>
          <Input id={timezoneId} name="timezone" defaultValue={user.timezone ?? ""} placeholder="America/New_York" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={localeId}>Locale</Label>
          <Input id={localeId} name="locale" defaultValue={user.locale ?? ""} placeholder="en-US" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={avatarId}>Avatar URL</Label>
        <Input id={avatarId} name="avatarUrl" type="url" defaultValue={user.avatarUrl ?? ""} placeholder="https://" aria-describedby={state.fieldErrors?.avatarUrl ? `${avatarId}-error` : undefined} />
        {state.fieldErrors?.avatarUrl ? (
          <p id={`${avatarId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.avatarUrl[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save changes
      </Button>
    </form>
  );
}
