import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, ShieldAlert, Users, Mail, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { invitationRepository } from "@/server/repositories/invitation-repository";
import { onboardingRepository } from "@/server/repositories/onboarding-repository";

export const metadata: Metadata = { title: "Organization" };

/**
 * Organization overview (spec section 53) — the landing page for a
 * specific organization: key metrics, an onboarding nudge if setup isn't
 * finished, and links into members/settings/invitations. `id` is a
 * client-supplied route param (spec section 48 IDOR) — never trusted
 * directly; `resolveOrganizationContext(id)` is the one thing that
 * decides whether the caller actually belongs to this organization, and
 * every read below runs scoped to that same, server-verified id.
 */
export default async function OrganizationDetailPage({ params }: PageProps<"/organizations/[id]">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.user) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Organization" />
        <EmptyState icon={ShieldAlert} title="Sign in required" />
      </div>
    );
  }

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("members.read")) {
    // Deliberately identical to "not found," not "forbidden" (spec
    // section 48/49) — confirming an organization ID exists to a caller
    // who isn't a member of it is its own information leak.
    notFound();
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  const [memberPage, pendingInvitations, onboarding] = await Promise.all([
    membershipRepository.listForOrganization(id, { page: 1, limit: 100 }),
    invitationRepository.listForOrganization(id, { page: 1, limit: 100 }, { status: "PENDING" }),
    onboardingRepository.findByOrganizationId(id),
  ]);

  // No `totalCount` — see pagination.ts: opt-in, and neither repository
  // requests it. `items.length` at a 100-row page is exact for every
  // realistic organization size this module ships with; a `hasNextPage`
  // (genuinely 100+) shows a "+" rather than a false-precise number.
  const memberCountLabel = `${memberPage.items.length}${memberPage.pageInfo.hasNextPage ? "+" : ""}`;
  const pendingInvitationCountLabel = `${pendingInvitations.items.length}${pendingInvitations.pageInfo.hasNextPage ? "+" : ""}`;
  const isOwner = context.membership?.role === "owner";
  const onboardingIncomplete = onboarding && !onboarding.completedAt;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={organization.displayName}
        description={organization.name}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: organization.displayName }]}
        actions={
          context.permissions.has("organizations.update") ? (
            <Button asChild variant="outline">
              <Link href={`/organizations/${id}/settings`}>
                <Settings2 />
                Settings
              </Link>
            </Button>
          ) : undefined
        }
      />

      {onboardingIncomplete ? (
        <Alert>
          <Building2 />
          <AlertTitle>Finish setting up this organization</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>Onboarding is still in progress ({onboarding.currentStep}).</span>
            <Button asChild size="sm" className="w-fit">
              <Link href={`/organizations/${id}/onboarding`}>Continue onboarding</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {organization.status !== "ACTIVE" ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>This organization is {organization.status.toLowerCase()}</AlertTitle>
          <AlertDescription>
            {organization.status === "SUSPENDED"
              ? "Members retain no access while suspended. Reactivation requires platform staff."
              : "This organization has been archived."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Members" value={memberCountLabel} icon={Users} />
        <MetricCard label="Pending invitations" value={pendingInvitationCountLabel} icon={Mail} />
        <Card className="gap-3">
          <CardContent className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-muted-foreground">Status</span>
              <StatusBadge status={organization.status === "ACTIVE" ? "success" : organization.status === "SUSPENDED" ? "warning" : "neutral"}>
                {organization.status}
              </StatusBadge>
            </div>
            {isOwner ? <StatusBadge status="primary">You&apos;re the owner</StatusBadge> : null}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Manage" description="Members, roles, and invitations for this organization." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <Link href={`/organizations/${id}/members`} className="flex flex-col gap-1 hover:underline">
                <span className="font-medium">Members</span>
                <span className="text-sm text-muted-foreground">Directory, roles, status</span>
              </Link>
            </CardContent>
          </Card>
          {context.permissions.has("members.invite") ? (
            <Card>
              <CardContent>
                <Link href={`/organizations/${id}/invitations`} className="flex flex-col gap-1 hover:underline">
                  <span className="font-medium">Invitations</span>
                  <span className="text-sm text-muted-foreground">Invite, revoke, resend</span>
                </Link>
              </CardContent>
            </Card>
          ) : null}
          {context.permissions.has("organizations.update") ? (
            <Card>
              <CardContent>
                <Link href={`/organizations/${id}/settings`} className="flex flex-col gap-1 hover:underline">
                  <span className="font-medium">Settings</span>
                  <span className="text-sm text-muted-foreground">Profile, lifecycle, ownership</span>
                </Link>
              </CardContent>
            </Card>
          ) : null}
          {context.permissions.has("audit.read") ? (
            <Card>
              <CardContent>
                <Link href={`/organizations/${id}/audit`} className="flex flex-col gap-1 hover:underline">
                  <span className="font-medium">Audit log</span>
                  <span className="text-sm text-muted-foreground">Who did what, when</span>
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
