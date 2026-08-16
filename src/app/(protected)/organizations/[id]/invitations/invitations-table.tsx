"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { DataTable, createDataTableColumnHelper } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { resendInvitationAction, revokeInvitationAction, type InvitationActionState } from "./actions";
import { formatInTimeZone } from "@/lib/utils/datetime";

export interface InvitationRow {
  id: string;
  email: string;
  roleName: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  invitedByName: string;
  createdAt: Date;
  expiresAt: Date;
}

const columnHelper = createDataTableColumnHelper<InvitationRow>();
const initialState: InvitationActionState = {};

/** Plain helper, not a component/hook — safe to call `Date.now()` here (see invitations/page.tsx's comment for why that distinction matters to the lint rule). */
function displayStatus(row: InvitationRow): { label: string; tone: "success" | "warning" | "destructive" | "neutral" } {
  if (row.status === "REVOKED") return { label: "Revoked", tone: "neutral" };
  if (row.status === "ACCEPTED") return { label: "Accepted", tone: "success" };
  if (row.expiresAt.getTime() < Date.now()) return { label: "Expired", tone: "warning" };
  return { label: "Pending", tone: "warning" };
}

export function InvitationsTable({ organizationId, invitations, canManage }: { organizationId: string; invitations: InvitationRow[]; canManage: boolean }) {
  const [confirmingRevoke, setConfirmingRevoke] = useState<InvitationRow | null>(null);
  const [revokeState, revokeAction] = useActionState(revokeInvitationAction, initialState);
  const [resendState, resendAction] = useActionState(resendInvitationAction, initialState);
  const [, startTransition] = useTransition();

  const columns = [
    columnHelper.accessor("email", { header: "Email" }),
    columnHelper.accessor("roleName", { header: "Offered role" }),
    columnHelper.display({
      id: "status",
      header: "Status",
      cell: (info) => {
        const { label, tone } = displayStatus(info.row.original);
        return <StatusBadge status={tone}>{label}</StatusBadge>;
      },
    }),
    columnHelper.accessor("invitedByName", { header: "Invited by" }),
    columnHelper.accessor("expiresAt", {
      header: "Expires",
      cell: (info) => formatInTimeZone(info.getValue(), "UTC", { hour: undefined, minute: undefined }),
    }),
    ...(canManage
      ? [
          columnHelper.display({
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: (info) => {
              const row = info.row.original;
              const canAct = row.status === "PENDING";
              if (!canAct) return null;
              return (
                <div className="flex items-center gap-2">
                  <form
                    action={(formData) => {
                      formData.set("organizationId", organizationId);
                      formData.set("invitationId", row.id);
                      resendAction(formData);
                    }}
                  >
                    <Button type="submit" variant="outline" size="sm">
                      Resend
                    </Button>
                  </form>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmingRevoke(row)}>
                    Revoke
                  </Button>
                </div>
              );
            },
          }),
        ]
      : []),
  ];

  return (
    <>
      {revokeState.error || resendState.error ? (
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertCircle />
          <AlertDescription>{revokeState.error ?? resendState.error}</AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        columns={columns}
        data={invitations}
        searchPlaceholder="Search invitations…"
        emptyTitle="No invitations yet"
        emptyDescription="Invite a teammate to see it appear here."
        pageSize={10}
      />
      <ConfirmDialog
        open={!!confirmingRevoke}
        onOpenChange={(open) => !open && setConfirmingRevoke(null)}
        title={`Revoke invitation to ${confirmingRevoke?.email ?? ""}?`}
        description="The invitation link stops working immediately."
        confirmLabel="Revoke"
        variant="destructive"
        onConfirm={() => {
          if (!confirmingRevoke) return;
          const formData = new FormData();
          formData.set("organizationId", organizationId);
          formData.set("invitationId", confirmingRevoke.id);
          startTransition(() => revokeAction(formData));
          setConfirmingRevoke(null);
        }}
      />
    </>
  );
}
