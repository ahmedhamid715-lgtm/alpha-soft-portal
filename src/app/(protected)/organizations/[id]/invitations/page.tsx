import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ShieldAlert } from "lucide-react";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { invitationRepository } from "@/server/repositories/invitation-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { InviteDialog } from "./invite-dialog";
import { InvitationsTable, type InvitationRow } from "./invitations-table";

export const metadata: Metadata = { title: "Invitations" };

export default async function InvitationsPage({ params }: PageProps<"/organizations/[id]/invitations">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) {
    notFound();
  }

  if (!context.permissions.has("members.invite") && !context.permissions.has("members.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invitations" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Invitations" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing invitations requires members.read or members.invite." />
      </div>
    );
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  const [invitationPage, roles] = await Promise.all([
    invitationRepository.listForOrganization(id, { page: 1, limit: 100 }),
    roleRepository.listAvailableForOrganization(id),
  ]);

  const roleOptions = roles.filter((role) => role.scope === "ORGANIZATION").map((role) => ({ id: role.id, name: role.name }));

  // "Expired" is deliberately NOT computed here — `Date.now()`/`new
  // Date()` during a component's render body is an impure call (React's
  // purity rule flags it even in a Server Component, since the same
  // render function must be safely re-callable); `InvitationsTable`'s
  // `displayStatus()` helper computes it instead, a plain function the
  // rule doesn't scan into.
  const rows: InvitationRow[] = invitationPage.items.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    roleName: invitation.role.name,
    status: invitation.status,
    invitedByName: invitation.invitedBy.name,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  }));

  const canInvite = context.permissions.has("members.invite");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invitations"
        description={organization.displayName}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: organization.displayName, href: `/organizations/${id}` }, { label: "Invitations" }]}
        actions={canInvite && roleOptions.length > 0 ? <InviteDialog organizationId={id} roleOptions={roleOptions} /> : undefined}
      />
      <InvitationsTable organizationId={id} invitations={rows} canManage={canInvite} />
    </div>
  );
}
