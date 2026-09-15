import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getWebsiteEngagementDetail } from "@/server/services/website-engagement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { EngagementWorkspace } from "./engagement-workspace";

export const metadata: Metadata = { title: "Website Engagement" };

export default async function WebsiteEngagementPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("website_development.manage");

  let detail;
  try {
    detail = await getWebsiteEngagementDetail({ engagementId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${detail.companyName} — ${detail.serviceName}`} breadcrumbs={[{ label: "Website Development", href: "/admin/websites" }, { label: detail.companyName }]} />
      <EngagementWorkspace detail={detail} canManage={canManage} />
    </div>
  );
}
