import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getServiceDefinition } from "@/server/services/service-definition-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { ServiceDefinitionDetail } from "./service-definition-detail";

export const metadata: Metadata = { title: "Service definition" };

export default async function ServiceDefinitionDetailPage({ params }: { params: Promise<{ definitionId: string }> }) {
  const { definitionId } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_services.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Service definition" breadcrumbs={[{ label: "Services", href: "/admin/services" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_services.read permission." />
      </div>
    );
  }

  let definition;
  try {
    definition = await getServiceDefinition({ definitionId });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canManage = context.permissions.has("delivery_services.catalog_manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={definition.name} breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: definition.name }]} />
      <ServiceDefinitionDetail definition={definition} canManage={canManage} />
    </div>
  );
}
