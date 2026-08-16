"use client";

import { useActionState, useId, useState } from "react";
import { AlertCircle, CheckCircle2, UserPlus, Loader2 } from "lucide-react";
import { createInvitationAction, type InvitationActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const initialState: InvitationActionState = {};

/**
 * The stateful body, in its own component so `key={resetKey}` on it
 * (from the parent, below) forces a genuinely fresh `useActionState` —
 * and therefore a fresh form, not a stale "invitation sent" success
 * message — every time the dialog is reopened. Deliberately not a
 * `useEffect`-driven `setOpen(false)` on success (that pattern cascades
 * renders); closing is always a direct user click here.
 */
function InviteDialogBody({ organizationId, roleOptions, onDone }: { organizationId: string; roleOptions: { id: string; name: string }[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(createInvitationAction, initialState);
  const emailId = useId();
  const roleId = useId();

  if (state.success) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2 />
          <AlertDescription>Invitation sent.</AlertDescription>
        </Alert>
        <Button className="w-fit" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="organizationId" value={organizationId} />
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Email</Label>
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
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Send invitation
      </Button>
    </form>
  );
}

export function InviteDialog({ organizationId, roleOptions }: { organizationId: string; roleOptions: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setResetKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>They&apos;ll receive a link valid for 7 days. Existing Alpha OS accounts join immediately after accepting.</DialogDescription>
        </DialogHeader>
        <InviteDialogBody key={resetKey} organizationId={organizationId} roleOptions={roleOptions} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
