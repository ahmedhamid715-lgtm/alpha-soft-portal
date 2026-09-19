import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getGhlEngagementDetail } from "@/server/services/ghl-engagement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { EngagementWorkspace } from "./engagement-workspace";

export const metadata: Metadata = { title: "GHL Engagement" };

export default async function GhlEngagementPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("ghl_automation.manage");

  let detail;
  try {
    detail = await getGhlEngagementDetail({ engagementId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${detail.companyName} — ${detail.serviceName}`} breadcrumbs={[{ label: "GHL Automation", href: "/admin/ghl" }, { label: detail.companyName }]} />
      <EngagementWorkspace detail={detail} canManage={canManage} />
    </div>
  );
}
