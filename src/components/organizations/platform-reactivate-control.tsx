"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { reactivateOrganizationPlatformAction, type OrganizationPlatformActionState } from "@/app/(protected)/admin/organizations/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const initialState: OrganizationPlatformActionState = {};

/**
 * The one lifecycle action platform staff take from this view — see
 * `organization-lifecycle.md` "The reactivation reachability gap" for
 * why suspend/archive are deliberately NOT offered here: those stay
 * organization self-service (`organizations.update`), which platform
 * staff don't hold for a customer organization they aren't a member of
 * — offering a button here that would just throw `AuthorizationError`
 * for the common case would be worse UX than not showing it at all.
 */
export function PlatformReactivateControl({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [state, action] = useActionState(reactivateOrganizationPlatformAction, initialState);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button variant="outline" className="w-fit" onClick={() => setConfirming(true)}>
        Reactivate organization
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Reactivate ${organizationName}?`}
        description="Members regain their previous access immediately."
        confirmLabel="Reactivate"
        loading={pending}
        onConfirm={() => {
          const formData = new FormData();
          formData.set("organizationId", organizationId);
          startTransition(() => action(formData));
          setConfirming(false);
        }}
      />
    </div>
  );
}
