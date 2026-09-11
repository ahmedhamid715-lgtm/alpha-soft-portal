import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getSeoEngagementDetail } from "@/server/services/seo-engagement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { EngagementWorkspace } from "./engagement-workspace";

export const metadata: Metadata = { title: "SEO Engagement" };

export default async function SeoEngagementPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("seo.manage");
  const canManageMeasurements = context.permissions.has("seo.measurements.manage");

  let detail;
  try {
    detail = await getSeoEngagementDetail({ engagementId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${detail.companyName} — ${detail.serviceName}`} breadcrumbs={[{ label: "SEO", href: "/admin/seo" }, { label: detail.companyName }]} />
      <EngagementWorkspace detail={detail} canManage={canManage} canManageMeasurements={canManageMeasurements} />
    </div>
  );
}
