import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Users, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getOrganizationForPlatform } from "@/server/services/organization-management-service";
import { toAppError } from "@/lib/errors/app-error";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { PlatformReactivateControl } from "@/components/organizations/platform-reactivate-control";

export const metadata: Metadata = { title: "Organization" };

function statusBadge(status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"): StatusBadgeProps["status"] {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SUSPENDED":
      return "warning";
    case "ARCHIVED":
      return "neutral";
  }
}

/**
 * The platform admin organization view (spec section 2) —
 * `organizations.read`. This is the ONLY reachable path for platform
 * staff to view/manage an organization they aren't themselves a member
 * of — see `docs/architecture/organization-lifecycle.md` "The
 * reactivation reachability gap" for the real, verified bug this page
 * closes (confirmed live: a genuine `platform_owner` visiting
 * `/organizations/{suspendedOrgId}/settings` saw "You don't have access
 * to this page," with no path to the Reactivate button they genuinely
 * held via their PLATFORM context).
 *
 * Deliberately narrow — owner name/email and a bounded membership
 * count, never a full member roster (that stays at
 * `/organizations/{id}/members`, gated by THAT organization's own
 * `members.read`) and never that organization's own audit trail (would
 * be exactly the "platform.readPlatform substituting for a customer
 * org's own trail" leak `audit-security.md`/`user-security.md` already
 * forbid for their own surfaces — see this page's own "Manage" links
 * below, which route to the real, independently-gated organization
 * pages instead of duplicating their content here).
 */
export default async function OrganizationPlatformDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("organizations.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Organization" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing an organization's platform profile requires the organizations.read permission." />
      </div>
    );
  }

  let detail;
  try {
    detail = await getOrganizationForPlatform({ organizationId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const { organization, owner, membershipCounts } = detail;
  const totalMembers = membershipCounts.ACTIVE + membershipCounts.SUSPENDED + membershipCounts.INVITED;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={organization.displayName}
        description={organization.slug}
        breadcrumbs={[{ label: "Organizations", href: "/admin/organizations" }, { label: organization.displayName }]}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={statusBadge(organization.status)}>{organization.status}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Owner</span>
              <span>{owner ? `${owner.name} (${owner.email})` : "No active owner"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{formatInTimeZone(organization.createdAt, "UTC")}</span>
            </div>
            {organization.archivedAt ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Archived</span>
                <span>{formatInTimeZone(organization.archivedAt, "UTC")}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <SectionHeader title="Lifecycle" description="Platform-administrative actions only." />
            {organization.status === "SUSPENDED" && context.permissions.has("organizations.reactivate") ? (
              <PlatformReactivateControl organizationId={organization.id} organizationName={organization.displayName} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {organization.status === "ACTIVE"
                  ? "Suspending or archiving an organization is self-service — managed from that organization's own settings by its owner/admin."
                  : organization.status === "ARCHIVED"
                    ? "This organization is archived. Archival is terminal and cannot be reversed from here."
                    : "No platform action is available for this organization's current status."}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Active members" value={String(membershipCounts.ACTIVE)} icon={Users} />
        <MetricCard label="Suspended members" value={String(membershipCounts.SUSPENDED)} icon={Users} />
        <MetricCard label="Total members" value={String(totalMembers)} icon={Users} />
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Manage" description="Full member/settings/audit management stays with that organization's own authorized pages." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <Link href={`/organizations/${id}`} className="flex items-center justify-between gap-2 hover:underline">
                <span className="flex flex-col gap-1">
                  <span className="font-medium">Organization overview</span>
                  <span className="text-sm text-muted-foreground">Requires membership in this organization</span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
