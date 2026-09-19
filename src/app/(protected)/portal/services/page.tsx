import type { Metadata } from "next";
import { Package } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getPortalServices } from "@/server/services/portal/portal-services-service";
import { customerServiceStatusVariant } from "@/components/services/service-status";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { SEO_FRESHNESS_LABELS } from "@/lib/seo/freshness";

export const metadata: Metadata = { title: "Services" };

const SOURCE_LABEL: Record<string, string> = {
  canonical: "Your active services",
  onboarding: "From your onboarding engagement",
  accepted_proposal: "From your accepted proposal",
  none: "",
};

/**
 * "My Services" (Build 26, upgraded Build 29) — a customer-safe
 * projection of real `CustomerService` engagements where any exist,
 * falling back to the original purchased/onboarding snapshot
 * otherwise. See `portal-services-service.ts`'s own precedence
 * writeup and customer-portal.md "My Services."
 */
export default async function PortalServicesPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Services" />;

  const services = await getPortalServices({ organizationId: guard.organizationId });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Services" description="What Alpha Page Rankers is delivering for your organization." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Services" }]} />

      {services.items.length === 0 ? (
        <EmptyState icon={Package} title="No services on file yet" description="Services will appear here once a proposal is accepted, onboarding begins, or a service is provisioned." />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{SOURCE_LABEL[services.source]}</p>
          {services.source === "canonical"
            ? services.items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{item.title}</span>
                      <StatusBadge status={customerServiceStatusVariant(item.status)}>{item.status}</StatusBadge>
                    </div>
                    {item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {item.targetEndDate ? <span>Target: {formatInTimeZone(item.targetEndDate, "UTC", { hour: undefined, minute: undefined })}</span> : null}
                      {item.linkedProjects.length > 0 ? <span>{item.linkedProjects.map((p) => p.title).join(", ")}</span> : null}
                    </div>
                    {item.category === "SEO" && item.seoPerformance ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                        <span>{item.seoPerformance.trackedKeywordCount} keyword(s) tracked</span>
                        <span>{item.seoPerformance.top10Count} in top 10</span>
                        <span>{item.seoPerformance.top20Count} in top 20</span>
                        {item.seoPerformance.averagePosition !== null ? <span>Avg. position {item.seoPerformance.averagePosition}</span> : null}
                        {item.seoPerformance.openCriticalIssueCount > 0 ? <span className="text-destructive">{item.seoPerformance.openCriticalIssueCount} critical issue(s)</span> : null}
                        <span>{SEO_FRESHNESS_LABELS[item.seoPerformance.freshness]}</span>
                      </div>
                    ) : null}
                    {item.category === "WEB_DEVELOPMENT" && item.websiteDevPerformance ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                        {item.websiteDevPerformance.primarySiteName ? <span>{item.websiteDevPerformance.primarySiteName}</span> : null}
                        {item.websiteDevPerformance.requiredPageCount > 0 ? (
                          <span>
                            {item.websiteDevPerformance.completedRequiredPageCount}/{item.websiteDevPerformance.requiredPageCount} required pages ready
                          </span>
                        ) : null}
                        {item.websiteDevPerformance.launchedAt ? (
                          <span>Launched {formatInTimeZone(item.websiteDevPerformance.launchedAt, "UTC", { hour: undefined, minute: undefined })}</span>
                        ) : item.websiteDevPerformance.launchTargetDate ? (
                          <span>Launch target: {formatInTimeZone(item.websiteDevPerformance.launchTargetDate, "UTC", { hour: undefined, minute: undefined })}</span>
                        ) : null}
                        {item.websiteDevPerformance.productionUrl ? (
                          <a href={item.websiteDevPerformance.productionUrl} target="_blank" rel="noopener noreferrer" className="underline">
                            Visit site
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {item.category === "LOCAL_SEO" && item.localSeoPerformance ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                        <span>{item.localSeoPerformance.activeLocationCount} location(s)</span>
                        <span>{item.localSeoPerformance.trackedKeywordCount} local keyword(s) tracked</span>
                        <span>{item.localSeoPerformance.localPackTop3Count} in Local Pack top 3</span>
                        {item.localSeoPerformance.averagePosition !== null ? <span>Avg. position {item.localSeoPerformance.averagePosition}</span> : null}
                        {item.localSeoPerformance.listingConsistencyPercent !== null ? <span>{item.localSeoPerformance.listingConsistencyPercent}% listings consistent</span> : null}
                        {item.localSeoPerformance.reviewCount > 0 ? (
                          <span>
                            {item.localSeoPerformance.reviewCount} review(s){item.localSeoPerformance.averageRating !== null ? `, ${item.localSeoPerformance.averageRating}★ avg` : ""}
                          </span>
                        ) : null}
                        {item.localSeoPerformance.openCriticalIssueCount > 0 ? <span className="text-destructive">{item.localSeoPerformance.openCriticalIssueCount} critical issue(s)</span> : null}
                        <span>{SEO_FRESHNESS_LABELS[item.localSeoPerformance.freshness]}</span>
                      </div>
                    ) : null}
                    {item.category === "ECOMMERCE" && item.ecommercePerformance ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                        <span>{item.ecommercePerformance.storeName}</span>
                        {item.ecommercePerformance.requiredProductCount > 0 ? (
                          <span>
                            {item.ecommercePerformance.completedRequiredProductCount}/{item.ecommercePerformance.requiredProductCount} required products ready
                          </span>
                        ) : null}
                        {item.ecommercePerformance.launchedAt ? (
                          <span>Launched {formatInTimeZone(item.ecommercePerformance.launchedAt, "UTC", { hour: undefined, minute: undefined })}</span>
                        ) : item.ecommercePerformance.launchTargetDate ? (
                          <span>Launch target: {formatInTimeZone(item.ecommercePerformance.launchTargetDate, "UTC", { hour: undefined, minute: undefined })}</span>
                        ) : null}
                        {item.ecommercePerformance.publicStorefrontUrl ? (
                          <a href={item.ecommercePerformance.publicStorefrontUrl} target="_blank" rel="noopener noreferrer" className="underline">
                            Visit store
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {item.category === "GHL_AUTOMATION" && item.ghlPerformance ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                        <span>{item.ghlPerformance.workspaceName}</span>
                        {item.ghlPerformance.requiredAssetCount > 0 ? (
                          <span>
                            {item.ghlPerformance.completedRequiredAssetCount}/{item.ghlPerformance.requiredAssetCount} required assets ready
                          </span>
                        ) : null}
                        {item.ghlPerformance.goLiveRecordedAt ? (
                          <span>Go-live {formatInTimeZone(item.ghlPerformance.goLiveRecordedAt, "UTC", { hour: undefined, minute: undefined })}</span>
                        ) : item.ghlPerformance.goLiveTargetDate ? (
                          <span>Go-live target: {formatInTimeZone(item.ghlPerformance.goLiveTargetDate, "UTC", { hour: undefined, minute: undefined })}</span>
                        ) : null}
                        <span>Handoff: {item.ghlPerformance.handoffStatus.replace("_", " ")}</span>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            : services.items.map((item, i) => (
                <Card key={`${item.title}-${i}`}>
                  <CardContent className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground">Qty {item.quantity}</span>
                    </div>
                    {item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}
                  </CardContent>
                </Card>
              ))}
        </div>
      )}
    </div>
  );
}
