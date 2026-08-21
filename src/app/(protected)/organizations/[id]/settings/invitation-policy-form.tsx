"use client";

import { useActionState, useId } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { updateInvitationPolicyAction, type SettingsActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: SettingsActionState = {};

/**
 * The Security section of `/organizations/[id]/settings` (Module 12).
 * Rendered only for the owner — `page.tsx` gates this entire section on
 * `organizations.security.update` before this component is ever mounted
 * (`canManage={false}` still renders it read-only for
 * `organizations.security.read`-only holders, i.e. `admin` — see that
 * permission's own split in `roles.ts`).
 */
export function InvitationPolicyForm({
  organizationId,
  policy,
  canManage,
}: {
  organizationId: string;
  policy: { requireOwnerForInvitations: boolean; allowedDomains: string[]; blockedDomains: string[]; invitationExpiryHours: number; isCustomized: boolean };
  canManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateInvitationPolicyAction, initialState);
  const requireOwnerId = useId();
  const allowedId = useId();
  const blockedId = useId();
  const expiryId = useId();

  // React resets a `<form>`'s UNCONTROLLED fields to their original
  // mount-time defaults after a successful Server Action completes (a
  // documented React 19 `<form>`-reset behavior — see
  // https://react.dev/reference/react-dom/hooks/useFormStatus and
  // `useActionState`'s own docs on form reset) — without this, a
  // successful save would flash the switch/textareas/input back to
  // their PRE-EDIT values for a moment, since `defaultChecked`/
  // `defaultValue` only apply once, at mount. Found live, not by
  // inspection, by this module's own E2E test. Keying each field on the
  // freshly revalidated `policy`'s own content (not on `state.success`,
  // which would also remount the `<form>` itself and lose the success
  // alert `state` carries) forces exactly those fields to remount with
  // the NEW server-confirmed values as their new mount-time default —
  // the form element and `useActionState`'s own state are untouched.
  const fieldsKey = `${policy.requireOwnerForInvitations}:${policy.allowedDomains.join(",")}:${policy.blockedDomains.join(",")}:${policy.invitationExpiryHours}`;

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
          <AlertDescription>Invitation policy updated.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={requireOwnerId}>Require the owner to send invitations</Label>
          <p className="text-sm text-muted-foreground">
            When on, only the organization owner can invite new members — administrators keep every other permission but not this one.
          </p>
        </div>
        <Switch key={fieldsKey} id={requireOwnerId} name="requireOwnerForInvitations" defaultChecked={policy.requireOwnerForInvitations} disabled={!canManage} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={allowedId}>Allowed domains</Label>
          <p className="text-xs text-muted-foreground">One domain per line. Leave empty to allow any domain. A bare domain matches that domain only, never its subdomains.</p>
          <Textarea
            key={fieldsKey}
            id={allowedId}
            name="allowedDomains"
            defaultValue={policy.allowedDomains.join("\n")}
            disabled={!canManage}
            rows={4}
            placeholder="example.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={blockedId}>Blocked domains</Label>
          <p className="text-xs text-muted-foreground">One domain per line. Checked before the allowed list — a domain here is always rejected.</p>
          <Textarea
            key={fieldsKey}
            id={blockedId}
            name="blockedDomains"
            defaultValue={policy.blockedDomains.join("\n")}
            disabled={!canManage}
            rows={4}
            placeholder="competitor.com"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor={expiryId}>Invitation link expiry (hours)</Label>
        <Input key={fieldsKey} id={expiryId} name="invitationExpiryHours" type="number" min={1} max={720} defaultValue={policy.invitationExpiryHours} disabled={!canManage} />
        <p className="text-xs text-muted-foreground">Between 1 and 720 hours (30 days). New invitations only — already-issued links keep their original expiry.</p>
      </div>

      {canManage ? (
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save changes
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Only the organization owner can change this policy.</p>
      )}
    </form>
  );
}
