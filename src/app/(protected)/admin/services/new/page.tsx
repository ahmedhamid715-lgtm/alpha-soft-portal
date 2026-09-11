import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { CreateServiceDefinitionForm } from "./create-service-definition-form";

export const metadata: Metadata = { title: "New service definition" };

export default async function NewServiceDefinitionPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_services.catalog_manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New service definition" breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: "New" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_services.catalog_manage permission." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New service definition" description="Add a service to the catalog." breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: "New" }]} />
      <CreateServiceDefinitionForm />
    </div>
  );
}
