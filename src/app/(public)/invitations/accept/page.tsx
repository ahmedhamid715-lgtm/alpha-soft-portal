import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getInvitationPreview } from "@/server/services/invitation-service";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invitation" };

const PREVIEW_ERROR_COPY: Record<string, string> = {
  invalid: "This invitation link is invalid.",
  expired: "This invitation has expired. Ask an organization admin to resend it.",
  already_used: "This invitation has already been used.",
};

/**
 * Invitation acceptance (spec sections 12–16) — the one page that works
 * for both a brand-new identity and an already-authenticated one. `token`
 * is a query param; `getInvitationPreview()` never returns anything
 * privacy-sensitive (no invitation id, no inviter identity — spec
 * section 52), just enough to render "you've been invited to join X as
 * Y." The actual acceptance (and its own, independent token/expiry/reuse
 * checks) happens in `acceptInvitationAction` on submit, never here.
 */
export default async function AcceptInvitationPage({ searchParams }: PageProps<"/invitations/accept">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <h1 className="sr-only">Accept invitation</h1>
        <CardHeader>
          <CardTitle className="text-xl" aria-hidden="true">Accept invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>This link is missing an invitation token.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const [preview, identity] = await Promise.all([getInvitationPreview(token), getCurrentUser()]);

  if (preview.outcome !== "found") {
    return (
      <Card className="w-full max-w-sm">
        <h1 className="sr-only">Accept invitation</h1>
        <CardHeader>
          <CardTitle className="text-xl" aria-hidden="true">Accept invitation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{PREVIEW_ERROR_COPY[preview.outcome]}</AlertDescription>
          </Alert>
          <Button asChild variant="outline">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="sr-only">Accept invitation to {preview.organizationName}</h1>
      <CardHeader>
        <CardTitle className="text-xl" aria-hidden="true">Join {preview.organizationName}</CardTitle>
        <CardDescription>Invited as {preview.roleName}</CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInvitationForm
          token={token}
          organizationName={preview.organizationName}
          roleName={preview.roleName}
          email={preview.email}
          isAuthenticated={!!identity}
          authenticatedEmail={identity?.user.email}
        />
      </CardContent>
    </Card>
  );
}
