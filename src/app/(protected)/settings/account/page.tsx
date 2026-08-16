import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { formatInTimeZone } from "@/lib/utils/datetime";

export const metadata: Metadata = { title: "Account" };

/**
 * Account status (spec section 25) — deliberately distinguishes three
 * independent statuses that are easy to conflate: the user's global
 * account (`user.status` — Module 04's authentication identity), each
 * membership's own status (per organization), and each organization's
 * own lifecycle status. None of the three imply the others; this page
 * shows all three side by side rather than collapsing them into one
 * badge. Email is read-only here — changing it needs re-verification,
 * which doesn't exist yet (see `user-repository.ts`'s `updateProfile`
 * comment); password changes go through Module 04's own
 * forgot-password flow, not this page.
 */
export default async function AccountSettingsPage() {
  const { user } = await requireAuthenticatedPage();
  const memberships = await membershipRepository.listForUser(user.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Account" description="Your Alpha OS identity — separate from any organization." breadcrumbs={[{ label: "Account" }]} />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Account status" />
        <Card className="max-w-xl">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Account status</span>
              <StatusBadge status={user.status === "ACTIVE" ? "success" : "warning"}>{user.status}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email verified</span>
              <StatusBadge status={user.emailVerifiedAt ? "success" : "warning"}>{user.emailVerifiedAt ? "Verified" : "Unverified"}</StatusBadge>
            </div>
            {user.lastLoginAt ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last sign-in</span>
                <span className="text-sm">{formatInTimeZone(user.lastLoginAt, "UTC")}</span>
              </div>
            ) : null}
            <Button asChild variant="outline" className="w-fit">
              <Link href="/forgot-password">Change password</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Organizations" description="Your membership status is independent of your account status and each organization's own status." />
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">You don&apos;t belong to any organization yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Your organization memberships, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Organization</th>
                  <th className="px-4 py-2.5">Your role</th>
                  <th className="px-4 py-2.5">Membership status</th>
                  <th className="px-4 py-2.5">Organization status</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((membership) => (
                  <tr key={membership.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/organizations/${membership.organizationId}`} className="hover:underline">
                        {membership.organization.displayName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{membership.role}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={membership.status === "ACTIVE" ? "success" : "warning"}>{membership.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={membership.organization.status === "ACTIVE" ? "success" : "warning"}>{membership.organization.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Button asChild variant="outline" className="w-fit">
          <Link href="/organizations">Switch organization</Link>
        </Button>
      </section>
    </div>
  );
}
