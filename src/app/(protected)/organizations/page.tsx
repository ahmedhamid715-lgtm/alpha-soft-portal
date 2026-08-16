import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { getSelectedOrganizationId } from "@/lib/tenancy";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { SwitchOrganizationForm } from "./switch-organization-form";

export const metadata: Metadata = { title: "Organizations" };

/**
 * Organization selection (spec section 8) — every organization a
 * multi-org user belongs to, with a way to pick which one is "current."
 * Membership/organization status are both shown and both enforced (spec
 * section 21/36): a `SUSPENDED` membership or non-`ACTIVE` organization
 * can be viewed here but not switched into — `SwitchOrganizationForm`
 * disables that row's control, and `selectOrganization()`
 * (`lib/tenancy/organization-selection.ts`) independently re-enforces
 * the same rule server-side regardless of what the UI shows.
 */
export default async function OrganizationsPage() {
  const identity = await getCurrentUser();
  if (!identity) return null; // unreachable — (protected)/layout.tsx already gates authentication

  const [memberships, selectedOrganizationId] = await Promise.all([
    membershipRepository.listForUser(identity.user.id),
    getSelectedOrganizationId(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Organizations"
        description="Every organization you belong to. Switch to change which one your session acts within."
      />

      {memberships.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organizations yet"
          description="You don't belong to any organization. An owner or admin must invite you first."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Organizations table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Organization</th>
                <th className="px-4 py-2.5">Your role</th>
                <th className="px-4 py-2.5">Membership</th>
                <th className="px-4 py-2.5">Organization status</th>
                <th className="px-4 py-2.5">Current</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((membership) => {
                const canSwitch = membership.status === "ACTIVE" && membership.organization.status === "ACTIVE";
                const isCurrent = membership.organizationId === selectedOrganizationId;
                return (
                  <tr key={membership.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-medium">{membership.organization.displayName}</span>
                        {membership.organization.isPlatform ? (
                          <span className="text-xs text-muted-foreground">Platform organization</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{membership.role}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={membership.status === "ACTIVE" ? "success" : "warning"}>
                        {membership.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={membership.organization.status === "ACTIVE" ? "success" : "warning"}>
                        {membership.organization.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2.5">{isCurrent ? <StatusBadge status="primary">Current</StatusBadge> : null}</td>
                    <td className="px-4 py-2.5">
                      <SwitchOrganizationForm organizationId={membership.organizationId} disabled={!canSwitch || isCurrent} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
