import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { MembersTable, type MemberRow } from "./members-table";

export const metadata: Metadata = { title: "Members" };

/**
 * Member directory (spec sections 9/10) — always scoped to the one
 * organization `resolveOrganizationContext(id)` independently verified
 * the caller belongs to (spec section 32: "search must never become a
 * global user directory"). `id` is a client-supplied route param; every
 * read below is scoped to the server-verified id, never the raw param.
 */
export default async function MembersPage({ params }: PageProps<"/organizations/[id]/members">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id || !context.permissions.has("members.read")) {
    notFound();
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  const [memberPage, roles] = await Promise.all([
    membershipRepository.listForOrganization(id, { page: 1, limit: 100 }),
    roleRepository.listAvailableForOrganization(id),
  ]);

  const roleOptions = roles.filter((role) => role.scope === "ORGANIZATION").map((role) => ({ id: role.id, name: role.name }));

  const rows: MemberRow[] = memberPage.items.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    roleId: membership.roleId,
    roleName: roleOptions.find((r) => r.id === membership.roleId)?.name ?? membership.role,
    status: membership.status as "ACTIVE" | "SUSPENDED",
    joinedAt: membership.joinedAt,
    isSelf: membership.userId === context.user!.id,
  }));

  const canManageRole = context.permissions.has("members.update");
  const canManageStatus = context.permissions.has("members.update");
  const canRemove = context.permissions.has("members.remove");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description={organization.displayName}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: organization.displayName, href: `/organizations/${id}` }, { label: "Members" }]}
        actions={
          context.permissions.has("members.invite") ? (
            <Button asChild variant="outline">
              <Link href={`/organizations/${id}/invitations`}>
                <Mail />
                Invitations
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* No "organization suspended" branch here — `members.read` is
          already empty in that case (spec section 21:
          resolveOrganizationContext zeroes ALL permissions for a
          non-ACTIVE organization), so the `notFound()` gate above
          already caught it. */}
      <MembersTable
        organizationId={id}
        members={rows}
        roleOptions={roleOptions}
        canManageRole={canManageRole}
        canManageStatus={canManageStatus}
        canRemove={canRemove}
      />
    </div>
  );
}
