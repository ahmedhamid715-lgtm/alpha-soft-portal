import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getCustomerServiceDetail } from "@/server/services/customer-service-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { getSeoEngagementByCustomerService } from "@/server/services/seo-engagement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { CustomerServiceDetailView } from "./customer-service-detail-view";

export const metadata: Metadata = { title: "Customer service" };

export default async function CustomerServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("delivery_services.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Customer service" breadcrumbs={[{ label: "Services", href: "/admin/services" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the delivery_services.read permission." />
      </div>
    );
  }

  let detail;
  try {
    detail = await getCustomerServiceDetail({ customerServiceId: id });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canManage = context.permissions.has("delivery_services.manage");
  const assignableUsers = canManage ? await listAssignableUsers() : [];

  // Build 30 — SEO OS. Only relevant when this service's own category is
  // SEO; the workspace is reached FROM here, matching the master
  // prompt's own "attach to the appropriate CustomerService" instruction
  // — Service Management stays the one place a specialist workspace is
  // provisioned from.
  const canSeeSeo = context.permissions.has("seo.read");
  const canManageSeo = context.permissions.has("seo.manage");
  const seoEngagement = detail.category === "SEO" && canSeeSeo ? await getSeoEngagementByCustomerService({ customerServiceId: id }) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={detail.serviceName} breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: detail.companyName, href: "/admin/services?tab=customers" }, { label: detail.serviceName }]} />
      <CustomerServiceDetailView detail={detail} canManage={canManage} assignableUsers={assignableUsers} canSeeSeo={canSeeSeo} canManageSeo={canManageSeo} seoEngagementId={seoEngagement?.id ?? null} />
    </div>
  );
}
