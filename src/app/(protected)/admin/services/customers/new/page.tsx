import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listCompanies } from "@/server/services/crm-company-service";
import { listActiveServiceDefinitions } from "@/server/services/service-definition-service";
import { listUnprovisionedOnboardingServiceItems } from "@/server/services/customer-service-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { ProvisionCustomerServiceForm } from "./provision-customer-service-form";
import { CreateCustomerServiceManuallyForm, type EligibleCompany } from "./create-customer-service-manually-form";

export const metadata: Metadata = { title: "New customer service" };

export default async function NewCustomerServicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_services.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New customer service" breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: "New" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_services.manage permission." />
      </div>
    );
  }

  const sourceOnboardingServiceItemId = typeof sp.sourceOnboardingServiceItemId === "string" ? sp.sourceOnboardingServiceItemId : undefined;
  const [definitions, assignableUsers] = await Promise.all([listActiveServiceDefinitions(), listAssignableUsers()]);

  if (sourceOnboardingServiceItemId) {
    const unmapped = await listUnprovisionedOnboardingServiceItems();
    const item = unmapped.find((i) => i.id === sourceOnboardingServiceItemId);
    if (!item) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="New customer service" breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: "New" }]} />
          <EmptyState icon={ShieldAlert} title="Already provisioned or not found" description="This onboarding service item no longer needs provisioning." />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Provision customer service" description={`From "${item.title}" — ${item.onboarding.linkedOrganization.displayName}.`} breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: "New" }]} />
        <ProvisionCustomerServiceForm sourceOnboardingServiceItemId={item.id} itemTitle={item.title} companyName={item.onboarding.linkedOrganization.displayName} definitions={definitions} assignableUsers={assignableUsers} />
      </div>
    );
  }

  const companiesPage = await listCompanies({ limit: 100, status: "ACTIVE" });
  const eligibleCompanies: EligibleCompany[] = companiesPage.items.filter((c) => c.convertedToOrganizationId !== null).map((c) => ({ id: c.id, name: c.name, convertedToOrganizationId: c.convertedToOrganizationId! }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New customer service" description="Create manually for an existing customer — no proposal/onboarding provenance." breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: "New" }]} />
      <CreateCustomerServiceManuallyForm companies={eligibleCompanies} definitions={definitions} assignableUsers={assignableUsers} />
    </div>
  );
}
