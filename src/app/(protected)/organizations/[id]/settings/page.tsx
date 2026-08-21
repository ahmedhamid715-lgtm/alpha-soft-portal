import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert } from "lucide-react";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { getInvitationPolicy } from "@/server/services/organization-security-service";
import { OrganizationProfileForm } from "./profile-form";
import { LifecycleControls } from "./lifecycle-controls";
import { OwnershipTransferDialog } from "./ownership-transfer-dialog";
import { InvitationPolicyForm } from "./invitation-policy-form";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage({ params }: PageProps<"/organizations/[id]/settings">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) {
    notFound();
  }

  if (!context.permissions.has("organizations.update")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Settings" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Settings" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Managing organization settings requires the organizations.update permission." />
      </div>
    );
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  const isOwner = context.membership?.role === "owner";
  const canReactivate = context.permissions.has("organizations.reactivate");
  const canReadSecurity = context.permissions.has("organizations.security.read");
  const canManageSecurity = context.permissions.has("organizations.security.update");
  const invitationPolicy = canReadSecurity ? await getInvitationPolicy({ organizationId: id }) : null;

  const eligibleMembers = isOwner
    ? (await membershipRepository.listForOrganization(id, { page: 1, limit: 100 }, { status: "ACTIVE" })).items
        .filter((m) => m.userId !== context.user!.id)
        .map((m) => ({ value: m.id, label: `${m.user.name} (${m.user.email})` }))
    : [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        description={organization.displayName}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: organization.displayName, href: `/organizations/${id}` }, { label: "Settings" }]}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Profile" description="Basic information other members and platform staff see." />
        <Card className="max-w-2xl">
          <CardContent>
            <OrganizationProfileForm
              organizationId={id}
              organization={{
                displayName: organization.displayName,
                industry: organization.industry,
                website: organization.website,
                country: organization.country,
                phone: organization.phone,
                primaryEmail: organization.primaryEmail,
              }}
              disabled={organization.status !== "ACTIVE"}
            />
          </CardContent>
        </Card>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Lifecycle" description="Suspend, reactivate, or archive this organization." />
        <Card className="max-w-2xl">
          <CardContent>
            <LifecycleControls organizationId={id} status={organization.status} canManage={context.permissions.has("organizations.update")} canReactivate={canReactivate} />
          </CardContent>
        </Card>
      </section>

      {invitationPolicy ? (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <SectionHeader title="Security" description="Who can invite new members, and from which email domains." />
            <Card className="max-w-2xl">
              <CardContent>
                <InvitationPolicyForm organizationId={id} policy={invitationPolicy} canManage={canManageSecurity} />
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}

      {isOwner ? (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <SectionHeader title="Ownership" description="Transfer ownership to another active member." />
            <Card className="max-w-2xl">
              <CardContent>
                <OwnershipTransferDialog organizationId={id} members={eligibleMembers} />
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
