import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getLocalSeoEngagementDetail } from "@/server/services/local-seo-engagement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { EngagementWorkspace } from "./engagement-workspace";

export const metadata: Metadata = { title: "Local SEO Engagement" };

export default async function LocalSeoEngagementPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("local_seo.manage");
  const canManageMeasurements = context.permissions.has("local_seo.measurements.manage");

  let detail;
  try {
    detail = await getLocalSeoEngagementDetail({ engagementId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${detail.companyName} — ${detail.serviceName}`} breadcrumbs={[{ label: "Local SEO", href: "/admin/local-seo" }, { label: detail.companyName }]} />
      <EngagementWorkspace detail={detail} canManage={canManage} canManageMeasurements={canManageMeasurements} />
    </div>
  );
}
