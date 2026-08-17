"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import type { User } from "@/generated/prisma/client";
import {
  updateUserProfileAction,
  suspendUserAction,
  reactivateUserAction,
  deactivateUserAction,
  type UserActionState,
} from "@/app/(protected)/admin/users/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

const initialState: UserActionState = {};

/**
 * Edit + lifecycle (spec sections 4/5/6/7) — three genuinely SEPARATE
 * mutations, each its own form/action, each independently authorized
 * server-side (`user-management-service.ts`): editing the name never
 * touches `status`, and every status transition is its own explicit,
 * confirmed action, never a side effect of another one.
 */
export function UserLifecyclePanel({ user, canEdit, canSuspend, canDeactivate, isSelf }: { user: User; canEdit: boolean; canSuspend: boolean; canDeactivate: boolean; isSelf: boolean }) {
  const [editState, editAction] = useActionState(updateUserProfileAction, initialState);
  const [suspendState, suspendAction] = useActionState(suspendUserAction, initialState);
  const [reactivateState, reactivateAction] = useActionState(reactivateUserAction, initialState);
  const [deactivateState, deactivateAction] = useActionState(deactivateUserAction, initialState);
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"suspend" | "deactivate" | null>(null);
  const nameId = useId();

  const error = editState.error ?? suspendState.error ?? reactivateState.error ?? deactivateState.error;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <form action={editAction} className="flex items-end gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input id={nameId} name="name" defaultValue={user.name} maxLength={200} disabled={!canEdit} />
          </div>
          <Button type="submit" variant="outline" disabled={!canEdit}>
            Save
          </Button>
        </form>

        <div className="flex flex-col gap-2">
          <Label>Account lifecycle</Label>
          {isSelf ? (
            <p className="text-sm text-muted-foreground">You can&apos;t suspend or deactivate your own account — ask another platform administrator.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {user.status === "ACTIVE" && canSuspend ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirming("suspend")}>
                  Suspend account
                </Button>
              ) : null}
              {(user.status === "SUSPENDED" || user.status === "DEACTIVATED") ? (
                <form action={reactivateAction}>
                  <input type="hidden" name="userId" value={user.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Reactivate account
                  </Button>
                </form>
              ) : null}
              {user.status !== "DEACTIVATED" && canDeactivate ? (
                <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming("deactivate")}>
                  Deactivate account
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <ConfirmDialog
          open={confirming === "suspend"}
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`Suspend ${user.name}?`}
          description="They're immediately signed out everywhere and can't sign back in until reactivated. This does not delete their account or organization memberships."
          confirmLabel="Suspend account"
          variant="destructive"
          onConfirm={() => {
            const formData = new FormData();
            formData.set("userId", user.id);
            startTransition(() => suspendAction(formData));
            setConfirming(null);
          }}
        />
        <ConfirmDialog
          open={confirming === "deactivate"}
          onOpenChange={(open) => !open && setConfirming(null)}
          title={`Deactivate ${user.name}?`}
          description="They're immediately signed out everywhere and can't sign back in until reactivated. Their account, memberships, and audit history are preserved — this is never a deletion."
          confirmLabel="Deactivate account"
          variant="destructive"
          onConfirm={() => {
            const formData = new FormData();
            formData.set("userId", user.id);
            startTransition(() => deactivateAction(formData));
            setConfirming(null);
          }}
        />
      </CardContent>
    </Card>
  );
}
