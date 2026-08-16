"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  assignMemberRoleAction,
  updateMemberStatusAction,
  removeMemberAction,
  type MemberActionState,
} from "./actions";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatInTimeZone } from "@/lib/utils/datetime";

export interface MemberDetail {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string;
  status: "ACTIVE" | "SUSPENDED";
  joinedAt: Date | null;
}

const initialState: MemberActionState = {};

/**
 * Member detail (spec section 10) — everything a directory row needs
 * without widening the table: role change (reuses `assignRole()`, same
 * chokepoint `/admin/roles` uses), suspend/reactivate, remove. Never
 * shows a password hash, credential, or token — there is nothing here to
 * accidentally expose (`MemberDetail` above has no such field at all).
 */
export function MemberDetailSheet({
  organizationId,
  member,
  roleOptions,
  canManageRole,
  canManageStatus,
  canRemove,
  onClose,
}: {
  organizationId: string;
  member: MemberDetail | null;
  roleOptions: { id: string; name: string }[];
  canManageRole: boolean;
  canManageStatus: boolean;
  canRemove: boolean;
  onClose: () => void;
}) {
  const [roleState, roleAction] = useActionState(assignMemberRoleAction, initialState);
  const [statusState, statusAction] = useActionState(updateMemberStatusAction, initialState);
  const [removeState, removeAction] = useActionState(removeMemberAction, initialState);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [, startTransition] = useTransition();
  const roleSelectId = useId();

  return (
    <Sheet open={!!member} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {member ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <SheetTitle>{member.name}</SheetTitle>
                  <SheetDescription>{member.email}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4">
              <div className="flex items-center gap-3">
                <StatusBadge status={member.status === "ACTIVE" ? "success" : "warning"}>{member.status}</StatusBadge>
                {member.joinedAt ? (
                  <span className="text-sm text-muted-foreground">Joined {formatInTimeZone(member.joinedAt, "UTC", { hour: undefined, minute: undefined })}</span>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={roleSelectId}>Role</Label>
                {roleState.error ? (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle />
                    <AlertDescription>{roleState.error}</AlertDescription>
                  </Alert>
                ) : null}
                {roleState.success ? (
                  <Alert>
                    <CheckCircle2 />
                    <AlertDescription>Role updated.</AlertDescription>
                  </Alert>
                ) : null}
                <form action={roleAction} className="flex items-center gap-2">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="membershipId" value={member.membershipId} />
                  <Select name="roleId" defaultValue={member.roleId ?? undefined} disabled={!canManageRole}>
                    <SelectTrigger id={roleSelectId} className="w-full">
                      <SelectValue placeholder={member.roleName} />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" variant="outline" size="sm" disabled={!canManageRole}>
                    Save
                  </Button>
                </form>
              </div>

              {canManageStatus ? (
                <div className="flex flex-col gap-2">
                  <Label>Membership status</Label>
                  {statusState.error ? (
                    <Alert variant="destructive" role="alert">
                      <AlertCircle />
                      <AlertDescription>{statusState.error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <form action={statusAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="membershipId" value={member.membershipId} />
                    <input type="hidden" name="status" value={member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                    <Button type="submit" variant="outline" size="sm">
                      {member.status === "ACTIVE" ? "Suspend member" : "Reactivate member"}
                    </Button>
                  </form>
                </div>
              ) : null}

              {canRemove ? (
                <div className="flex flex-col gap-2">
                  <Label>Danger zone</Label>
                  {removeState.error ? (
                    <Alert variant="destructive" role="alert">
                      <AlertCircle />
                      <AlertDescription>{removeState.error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button variant="destructive" size="sm" className="w-fit" onClick={() => setConfirmingRemove(true)}>
                    Remove from organization
                  </Button>
                </div>
              ) : null}
            </div>

            <SheetFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </SheetFooter>

            <ConfirmDialog
              open={confirmingRemove}
              onOpenChange={setConfirmingRemove}
              title={`Remove ${member.name}?`}
              description="They immediately lose all access to this organization. This does not delete their Alpha OS account."
              confirmLabel="Remove member"
              variant="destructive"
              onConfirm={() => {
                const formData = new FormData();
                formData.set("organizationId", organizationId);
                formData.set("membershipId", member.membershipId);
                startTransition(() => removeAction(formData));
                setConfirmingRemove(false);
                onClose();
              }}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
