import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getCustomerServiceDetail } from "@/server/services/customer-service-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { getSeoEngagementByCustomerService } from "@/server/services/seo-engagement-service";
import { getLocalSeoEngagementByCustomerService } from "@/server/services/local-seo-engagement-service";
import { getWebsiteEngagementByCustomerService } from "@/server/services/website-engagement-service";
import { getEcommerceEngagementByCustomerService } from "@/server/services/ecommerce-engagement-service";
import { getGhlEngagementByCustomerService } from "@/server/services/ghl-engagement-service";
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

  // Build 31 — GBP / Local SEO. Same "attach to the appropriate
  // CustomerService, provisioned from Service Management" reasoning as
  // SEO OS immediately above — a SEPARATE specialist domain, own
  // eligibility category (LOCAL_SEO, never SEO).
  const canSeeLocalSeo = context.permissions.has("local_seo.read");
  const canManageLocalSeo = context.permissions.has("local_seo.manage");
  const localSeoEngagement = detail.category === "LOCAL_SEO" && canSeeLocalSeo ? await getLocalSeoEngagementByCustomerService({ customerServiceId: id }) : null;

  // Build 32 — Website Development OS. Same "attach to the appropriate
  // CustomerService, provisioned from Service Management" reasoning as
  // SEO OS/Local SEO immediately above — a THIRD, separate specialist
  // domain, own eligibility category (WEB_DEVELOPMENT, never SEO/
  // LOCAL_SEO).
  const canSeeWebsiteDev = context.permissions.has("website_development.read");
  const canManageWebsiteDev = context.permissions.has("website_development.manage");
  const websiteEngagement = detail.category === "WEB_DEVELOPMENT" && canSeeWebsiteDev ? await getWebsiteEngagementByCustomerService({ customerServiceId: id }) : null;

  // Build 33 — E-Commerce Development OS. Same "attach to the
  // appropriate CustomerService, provisioned from Service Management"
  // reasoning as SEO OS/Local SEO/Website Dev immediately above — a
  // FOURTH, separate specialist domain, own eligibility category
  // (ECOMMERCE, never SEO/LOCAL_SEO/WEB_DEVELOPMENT).
  const canSeeEcommerce = context.permissions.has("ecommerce_development.read");
  const canManageEcommerce = context.permissions.has("ecommerce_development.manage");
  const ecommerceEngagement = detail.category === "ECOMMERCE" && canSeeEcommerce ? await getEcommerceEngagementByCustomerService({ customerServiceId: id }) : null;

  // Build 34 — GHL Automation OS. Same "attach to the appropriate
  // CustomerService, provisioned from Service Management" reasoning as
  // SEO OS/Local SEO/Website Dev/E-Commerce immediately above — a
  // FIFTH, separate specialist domain, own eligibility category
  // (GHL_AUTOMATION, never SEO/LOCAL_SEO/WEB_DEVELOPMENT/ECOMMERCE).
  const canSeeGhl = context.permissions.has("ghl_automation.read");
  const canManageGhl = context.permissions.has("ghl_automation.manage");
  const ghlEngagement = detail.category === "GHL_AUTOMATION" && canSeeGhl ? await getGhlEngagementByCustomerService({ customerServiceId: id }) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={detail.serviceName} breadcrumbs={[{ label: "Services", href: "/admin/services" }, { label: detail.companyName, href: "/admin/services?tab=customers" }, { label: detail.serviceName }]} />
      <CustomerServiceDetailView
        detail={detail}
        canManage={canManage}
        assignableUsers={assignableUsers}
        canSeeSeo={canSeeSeo}
        canManageSeo={canManageSeo}
        seoEngagementId={seoEngagement?.id ?? null}
        canSeeLocalSeo={canSeeLocalSeo}
        canManageLocalSeo={canManageLocalSeo}
        localSeoEngagementId={localSeoEngagement?.id ?? null}
        canSeeWebsiteDev={canSeeWebsiteDev}
        canManageWebsiteDev={canManageWebsiteDev}
        websiteEngagementId={websiteEngagement?.id ?? null}
        canSeeEcommerce={canSeeEcommerce}
        canManageEcommerce={canManageEcommerce}
        ecommerceEngagementId={ecommerceEngagement?.id ?? null}
        canSeeGhl={canSeeGhl}
        canManageGhl={canManageGhl}
        ghlEngagementId={ghlEngagement?.id ?? null}
      />
    </div>
  );
}
