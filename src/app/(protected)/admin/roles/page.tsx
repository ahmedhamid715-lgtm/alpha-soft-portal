import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext, resolveOrganizationContext } from "@/lib/authorization/context";
import { roleRepository } from "@/server/repositories/role-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { RoleAssignmentForm } from "./role-assignment-form";

export const metadata: Metadata = { title: "Roles & Permissions" };

/**
 * Module 05's role-management demonstration (spec section 33) — a
 * minimal, real enterprise-security-console page, not a generic CRUD
 * screen. Deliberately reached at `/admin/roles`, a NEW route, rather
 * than retrofitted onto the existing `(protected)/admin/page.tsx` —
 * Module 04's own seeded accounts (`owner@alpha-os.test`, tested by
 * Module 04's own E2E suite) predate Module 05's role system and hold no
 * `Role` assignment (`roleId` is null — see `prisma/seed-rbac.ts`'s top
 * comment for why that data is deliberately left un-migrated); gating
 * the *existing* `/admin` page here would have broken those already-
 * passing Module 04 tests. This page is authorization-gated
 * independently, on top of `(protected)/layout.tsx`'s unchanged
 * authentication gate.
 *
 * Tries the platform scope first, then the caller's organization scope —
 * see `docs/architecture/rbac.md` "UI" for why a single page legitimately
 * serves both audiences and how it decides which view to render, rather
 * than guessing from `resolveOrganizationContext()`'s catalog-based
 * auto-routing (`roles.read` is catalogued ORGANIZATION-primary; a
 * platform-only user has no organization membership for that resolver to
 * find at all).
 */
export default async function RolesPage() {
  const platformContext = await resolvePlatformContext();
  const orgContext = platformContext.permissions.has("roles.read")
    ? null
    : await resolveOrganizationContext();

  const context = platformContext.permissions.has("roles.read") ? platformContext : orgContext;

  if (!context || !context.permissions.has("roles.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Roles & Permissions" />
        <EmptyState
          icon={ShieldAlert}
          title="You don't have access to this page"
          description="Viewing roles and permissions requires the roles.read permission, resolved server-side from your session — not from anything the browser sent. See docs/architecture/rbac.md."
        />
      </div>
    );
  }

  const isPlatformView = context.isPlatformStaff && context === platformContext;
  const canManageMembers = context.permissions.has("members.update");

  const roles = await roleRepository.listWithPermissions(
    isPlatformView
      ? { organizationId: null, scope: "PLATFORM" }
      : { OR: [{ organizationId: null, scope: "ORGANIZATION" }, { organizationId: context.organizationId! }] },
  );

  const members = isPlatformView || !context.organizationId
    ? []
    : (await membershipRepository.listForOrganization(context.organizationId, { page: 1, limit: 50 })).items;

  const roleOptions = roles.map((role) => ({ id: role.id, name: role.name, isSystem: role.isSystem }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Roles & Permissions"
        description={
          isPlatformView
            ? "Platform-wide system roles and what each one grants."
            : "This organization's roles — system-defined and custom — and who holds each one."
        }
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Roles" description={`${roles.length} role${roles.length === 1 ? "" : "s"}`} />
        <div
          className="overflow-x-auto rounded-lg border border-border"
          tabIndex={0}
          role="region"
          aria-label="Roles table, scrollable on narrow viewports"
        >
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Scope</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-medium">{role.name}</span>
                      <span className="text-xs text-muted-foreground">{role.key}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={role.scope === "PLATFORM" ? "primary" : "info"}>{role.scope}</StatusBadge>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={role.isSystem ? "neutral" : "success"}>
                      {role.isSystem ? "System" : "Custom"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{role.rolePermissions.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {!isPlatformView ? (
        <section className="flex flex-col gap-4">
          <SectionHeader
            title="Members"
            description={canManageMembers ? "Assign a role to each member." : "Role assignment requires members.update."}
          />
          {members.length === 0 ? (
            <EmptyState title="No members yet" description="Members appear here once they join this organization." />
          ) : (
            <div
              className="overflow-x-auto rounded-lg border border-border"
              tabIndex={0}
              role="region"
              aria-label="Members table, scrollable on narrow viewports"
            >
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Member</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="font-medium">{member.user.name}</span>
                          <span className="text-xs text-muted-foreground">{member.user.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={member.status === "ACTIVE" ? "success" : "warning"}>
                          {member.status}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-2.5">
                        <RoleAssignmentForm
                          membershipId={member.id}
                          currentRoleId={member.roleId}
                          options={roleOptions}
                          disabled={!canManageMembers}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
