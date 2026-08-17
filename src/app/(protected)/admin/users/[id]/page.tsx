import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { ActivityTimeline, type TimelineEntry } from "@/components/shared/activity-timeline";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getUserDetail } from "@/server/services/user-management-service";
import { toAppError } from "@/lib/errors/app-error";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { UserLifecyclePanel } from "@/components/users/user-lifecycle-panel";
import { UserSessionsPanel } from "@/components/users/user-sessions-panel";
import { UserInvitationsPanel } from "@/components/users/user-invitations-panel";
import type { AuditEvent } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "User" };

function accountStatusBadge(status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED"): StatusBadgeProps["status"] {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SUSPENDED":
      return "warning";
    case "DEACTIVATED":
      return "destructive";
    default:
      return "neutral";
  }
}

const ACTIVITY_LABELS: Record<string, string> = {
  "auth.login.success": "signed in",
  "auth.logout": "signed out",
  "profile.updated": "updated their profile",
  "auth.session.revoked": "had a session revoked",
  "user.created": "was created",
  "user.updated": "was edited by an administrator",
  "user.suspended": "was suspended",
  "user.reactivated": "was reactivated",
  "user.deactivated": "was deactivated",
};

function toTimelineEntry(event: AuditEvent): TimelineEntry {
  return {
    id: event.id,
    action: ACTIVITY_LABELS[event.action] ?? event.action,
    timestamp: event.createdAt,
    detail: event.outcome !== "SUCCESS" ? <StatusBadge status={event.outcome === "DENIED" ? "warning" : "destructive"}>{event.outcome}</StatusBadge> : undefined,
  };
}

/**
 * The global user-detail view (spec section 2) — `users.read`. Composes
 * five read-only panels plus the lifecycle-mutation panel, ALL sourced
 * from `getUserDetail()` (one query composition, not five separate
 * permission-checked round trips — see that function's own doc comment).
 * Never renders a password hash, credential, session token, reset
 * token, invitation token, or API secret — there is no such field on
 * any of `UserDetail`'s member types to accidentally expose (spec
 * section 2's own explicit prohibition, held structurally, not just by
 * convention — same discipline `MemberDetail` already established in
 * Module 07).
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("users.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="User" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing a user's profile requires the users.read permission." />
      </div>
    );
  }

  let detail;
  try {
    detail = await getUserDetail({ userId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const { user, memberships, sessions, invitations, recentActivity } = detail;
  const isSelf = context.user!.id === user.id;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={user.name}
        description={user.email}
        breadcrumbs={[{ label: "Users", href: "/admin/users" }, { label: user.name }]}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-medium">{user.name}</span>
                <span className="text-sm text-muted-foreground">{user.email}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Account status</span>
                <StatusBadge status={accountStatusBadge(user.status)}>{user.status}</StatusBadge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email verified</span>
                <StatusBadge status={user.emailVerifiedAt ? "success" : "warning"}>{user.emailVerifiedAt ? "Verified" : "Unverified"}</StatusBadge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatInTimeZone(user.createdAt, "UTC")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last sign-in</span>
                <span>{user.lastLoginAt ? formatInTimeZone(user.lastLoginAt, "UTC") : "Never"}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <UserLifecyclePanel
          user={user}
          canEdit={context.permissions.has("users.update")}
          canSuspend={context.permissions.has("users.update")}
          canDeactivate={context.permissions.has("users.delete")}
          isSelf={isSelf}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Organizations" description="Membership is managed per organization — this is a read-only summary." />
        {memberships.length === 0 ? (
          <EmptyState title="No organization memberships" description="This person doesn't belong to any organization yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Organization memberships, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Organization</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Manage</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((membership) => (
                  <tr key={membership.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{membership.organization.displayName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{membership.role}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={membership.status === "ACTIVE" ? "success" : "warning"}>{membership.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/organizations/${membership.organizationId}/members`} className="text-sm text-muted-foreground hover:underline">
                        Manage in org →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Sessions" description="Every device currently signed in as this person." />
        <UserSessionsPanel userId={user.id} sessions={sessions} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Invitations" description="Every organization invitation ever sent to this email address." />
        <UserInvitationsPanel userId={user.id} invitations={invitations} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Recent activity" description="Platform-level events only — never another organization's own audit trail (see docs/architecture/user-security.md)." />
        {recentActivity.length === 0 ? (
          <EmptyState icon={History} title="No recent activity" description="Nothing platform-level recorded for this account yet." />
        ) : (
          <ActivityTimeline entries={recentActivity.map(toTimelineEntry)} />
        )}
      </section>
    </div>
  );
}
