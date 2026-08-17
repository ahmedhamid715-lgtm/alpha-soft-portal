"use client";

import { useActionState, useState, useTransition } from "react";
import type { UserSession } from "@/generated/prisma/client";
import { revokeUserSessionAction, type UserActionState } from "@/app/(protected)/admin/users/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MonitorSmartphone } from "lucide-react";
import { formatInTimeZone } from "@/lib/utils/datetime";

const initialState: UserActionState = {};

/**
 * Session visibility/management (spec section 11) — admin-on-another-
 * user variant. Only ever the SAFE columns `UserSession` has (device
 * label, created/last-active time) — there is no token/secret field on
 * this model to accidentally render (see `prisma/schema.prisma`'s own
 * comment: "truncated on write, informational only").
 */
export function UserSessionsPanel({ userId, sessions }: { userId: string; sessions: UserSession[] }) {
  const [state, action] = useActionState(revokeUserSessionAction, initialState);
  const [, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return <EmptyState icon={MonitorSmartphone} title="No active sessions" description="This account has no live sessions right now." />;
  }

  return (
    <div className="flex flex-col gap-2">
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm">{session.userAgent ?? "Unknown device"}</span>
              <span className="text-xs text-muted-foreground">Last active {formatInTimeZone(session.lastActiveAt, "UTC")}</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingId(session.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmingId !== null}
        onOpenChange={(open) => !open && setConfirmingId(null)}
        title="Revoke this session?"
        description="This device is immediately signed out."
        confirmLabel="Revoke session"
        variant="destructive"
        onConfirm={() => {
          if (!confirmingId) return;
          const formData = new FormData();
          formData.set("userId", userId);
          formData.set("sessionId", confirmingId);
          startTransition(() => action(formData));
          setConfirmingId(null);
        }}
      />
    </div>
  );
}
