import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { sessionService } from "@/server/services/session-service";
import { OwnSessionsList } from "@/components/users/own-sessions-list";
import { revokeOtherSessionsAction } from "./actions";

export const metadata: Metadata = { title: "Sessions" };

/**
 * Self-service session management (spec section 11) — "a user should be
 * able to manage their own sessions." Reuses `sessionService`
 * (Module 04) verbatim; this page and its actions are the first UI ever
 * built for it — Module 04 shipped the table/repository/service and
 * explicitly deferred the UI (see `UserSession`'s own schema comment:
 * "for the future session-management UI, not built in this module").
 */
export default async function SessionsPage() {
  const { user, sessionId } = await requireAuthenticatedPage();
  const sessions = await sessionService.listActiveSessions(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sessions"
        description="Every device currently signed in to your Alpha OS account."
        breadcrumbs={[{ label: "Account", href: "/settings/account" }, { label: "Sessions" }]}
        actions={
          sessions.length > 1 ? (
            <form action={revokeOtherSessionsAction}>
              <Button type="submit" variant="outline">
                Sign out other devices
              </Button>
            </form>
          ) : undefined
        }
      />
      <OwnSessionsList sessions={sessions} currentSessionId={sessionId} />
    </div>
  );
}
