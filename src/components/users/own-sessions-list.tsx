"use client";

import { useActionState } from "react";
import type { UserSession } from "@/generated/prisma/client";
import { revokeOwnSessionAction, type SessionActionState } from "@/app/(protected)/settings/sessions/actions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatInTimeZone } from "@/lib/utils/datetime";

const initialState: SessionActionState = {};

export function OwnSessionsList({ sessions, currentSessionId }: { sessions: UserSession[]; currentSessionId: string }) {
  const [state, action] = useActionState(revokeOwnSessionAction, initialState);

  return (
    <div className="flex flex-col gap-2">
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {sessions.map((session) => {
          const isCurrent = session.id === currentSessionId;
          return (
            <li key={session.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex flex-col">
                <span className="flex items-center gap-2 text-sm">
                  {session.userAgent ?? "Unknown device"}
                  {isCurrent ? <StatusBadge status="primary">This device</StatusBadge> : null}
                </span>
                <span className="text-xs text-muted-foreground">Last active {formatInTimeZone(session.lastActiveAt, "UTC")}</span>
              </div>
              {!isCurrent ? (
                <form action={action}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Sign out
                  </Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
