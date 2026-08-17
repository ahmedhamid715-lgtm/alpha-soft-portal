"use client";

import { useActionState } from "react";
import type { Invitation, Organization, Role } from "@/generated/prisma/client";
import { resendUserInvitationAction, revokeUserInvitationAction, type UserActionState } from "@/app/(protected)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { MailPlus } from "lucide-react";
import { formatInTimeZone } from "@/lib/utils/datetime";

type InvitationRow = Invitation & { organization: Organization; role: Role };

/**
 * Plain helpers, not components/hooks — safe to call `Date.now()` here
 * (same established exception `invitations-table.tsx`'s own
 * `displayStatus()` already documents: React's purity rule flags
 * `Date.now()`/`new Date()` called directly in a component's render
 * body — even a Server Component's — but not inside a genuinely
 * separate, lowercase-named function the linter doesn't scan into).
 */
function statusBadge(invitation: InvitationRow): { status: StatusBadgeProps["status"]; label: string } {
  if (invitation.status === "ACCEPTED") return { status: "success", label: "Accepted" };
  if (invitation.status === "REVOKED") return { status: "neutral", label: "Revoked" };
  if (invitation.expiresAt.getTime() < Date.now()) return { status: "warning", label: "Expired" };
  return { status: "info", label: "Pending" };
}

function isInvitationPending(invitation: InvitationRow): boolean {
  return invitation.status === "PENDING" && invitation.expiresAt.getTime() >= Date.now();
}

const initialState: UserActionState = {};

/**
 * Cross-org invitation history (spec section 10) — read-only rows, but
 * REAL resend/revoke buttons wired directly to `invitation-service.ts`'s
 * existing `resendInvitation()`/`revokeInvitation()` (see
 * `admin/users/actions.ts`'s own comment): each independently
 * re-authorizes `members.invite` in THAT invitation's own organization
 * server-side, so an unauthorized attempt from this global view fails
 * safely with a normal error, never a silent bypass — no client-side
 * permission pre-check is required here for that to be secure, only for
 * good UX (not built — see `docs/architecture/user-management.md`
 * "Deliberate simplifications").
 */
export function UserInvitationsPanel({ userId, invitations }: { userId: string; invitations: InvitationRow[] }) {
  const [resendState, resendAction] = useActionState(resendUserInvitationAction, initialState);
  const [revokeState, revokeAction] = useActionState(revokeUserInvitationAction, initialState);

  if (invitations.length === 0) {
    return <EmptyState icon={MailPlus} title="No invitations" description="This email has never been invited to an organization." />;
  }

  return (
    <div className="flex flex-col gap-2">
      {(resendState.error || revokeState.error) ? (
        <p className="text-sm text-destructive" role="alert">
          {resendState.error ?? revokeState.error}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {invitations.map((invitation) => {
          const badge = statusBadge(invitation);
          const isPending = isInvitationPending(invitation);
          return (
            <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{invitation.organization.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  Invited as {invitation.role.name} · {formatInTimeZone(invitation.createdAt, "UTC")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
                {isPending ? (
                  <>
                    <form action={resendAction}>
                      <input type="hidden" name="userId" value={userId} />
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <input type="hidden" name="organizationId" value={invitation.organizationId} />
                      <Button type="submit" variant="outline" size="sm">
                        Resend
                      </Button>
                    </form>
                    <form action={revokeAction}>
                      <input type="hidden" name="userId" value={userId} />
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <input type="hidden" name="organizationId" value={invitation.organizationId} />
                      <Button type="submit" variant="ghost" size="sm">
                        Revoke
                      </Button>
                    </form>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
