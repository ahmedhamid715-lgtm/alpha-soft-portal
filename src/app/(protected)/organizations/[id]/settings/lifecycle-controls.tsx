"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import {
  suspendOrganizationAction,
  reactivateOrganizationAction,
  archiveOrganizationAction,
  type SettingsActionState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const initialState: SettingsActionState = {};

/**
 * Suspend/reactivate/archive (spec section 23). Reactivate is only ever
 * rendered when the caller holds `organizations.reactivate` — platform
 * staff, never the organization's own admin/owner (see
 * `organizations.reactivate`'s doc comment, permissions.ts: a suspended
 * org cannot un-suspend itself). No hard delete anywhere in this
 * component — see spec section 22.
 */
export function LifecycleControls({
  organizationId,
  status,
  canManage,
  canReactivate,
}: {
  organizationId: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  canManage: boolean;
  canReactivate: boolean;
}) {
  const [confirming, setConfirming] = useState<"suspend" | "archive" | "reactivate" | null>(null);
  const [suspendState, suspendAction] = useActionState(suspendOrganizationAction, initialState);
  const [reactivateState, reactivateAction] = useActionState(reactivateOrganizationAction, initialState);
  const [archiveState, archiveAction] = useActionState(archiveOrganizationAction, initialState);
  const [pending, startTransition] = useTransition();

  function submit(action: (payload: FormData) => void) {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    startTransition(() => action(formData));
  }

  const combinedError = suspendState.error ?? archiveState.error ?? reactivateState.error;

  return (
    <div className="flex flex-col gap-3">
      {combinedError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{combinedError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" && canManage ? (
          <Button variant="outline" onClick={() => setConfirming("suspend")}>
            Suspend organization
          </Button>
        ) : null}
        {status === "SUSPENDED" && canReactivate ? (
          <Button variant="outline" onClick={() => setConfirming("reactivate")}>
            Reactivate organization
          </Button>
        ) : null}
        {status !== "ARCHIVED" && canManage ? (
          <Button variant="destructive" onClick={() => setConfirming("archive")}>
            Archive organization
          </Button>
        ) : null}
      </div>
      {status === "SUSPENDED" && !canReactivate ? (
        <p className="text-sm text-muted-foreground">Reactivation requires platform staff — an organization cannot un-suspend itself.</p>
      ) : null}

      <ConfirmDialog
        open={confirming === "suspend"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Suspend this organization?"
        description="Members lose all access immediately. Only platform staff can reactivate it afterward."
        confirmLabel="Suspend"
        variant="destructive"
        loading={pending}
        onConfirm={() => submit(suspendAction)}
      />
      <ConfirmDialog
        open={confirming === "reactivate"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Reactivate this organization?"
        description="Members regain their previous access immediately."
        confirmLabel="Reactivate"
        loading={pending}
        onConfirm={() => submit(reactivateAction)}
      />
      <ConfirmDialog
        open={confirming === "archive"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Archive this organization?"
        description="This is not a deletion — data is retained, but the organization becomes inactive. This action cannot be undone from this screen."
        confirmLabel="Archive"
        variant="destructive"
        loading={pending}
        onConfirm={() => submit(archiveAction)}
      />
    </div>
  );
}
