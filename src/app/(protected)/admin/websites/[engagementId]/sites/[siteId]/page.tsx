import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getWebsiteSiteOverview, listWebsitePages } from "@/server/services/website-engagement-service";
import { listWebsiteDeployments } from "@/server/services/website-deployment-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { websiteSiteStatusVariant, launchReadinessVariant, WEBSITE_PLATFORM_LABELS } from "@/components/website-dev/website-status";
import { OverviewTab } from "./overview-tab";
import { PagesTab } from "./pages-tab";
import { EnvironmentsTab } from "./environments-tab";
import { QaTab } from "./qa-tab";
import { DeploymentsTab } from "./deployments-tab";
import type { WebsiteEnvironmentType } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Website Site" };

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const TABS = ["overview", "pages", "environments", "qa", "deployments"] as const;
type Tab = (typeof TABS)[number];

export default async function WebsiteSitePage({ params, searchParams }: { params: Promise<{ engagementId: string; siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { engagementId, siteId } = await params;
  const sp = await searchParams;
  const tab = (single(sp.tab) as Tab | undefined) && TABS.includes(single(sp.tab) as Tab) ? (single(sp.tab) as Tab) : "overview";

  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("website_development.manage");
  const canDeploy = context.permissions.has("website_development.deploy");

  let overview;
  try {
    // Codex Performance Engineer finding PERF-03 (Build 32 review) — a
    // single service call now, not a separate `getWebsiteEngagement()`
    // waterfall purely for the QA tab's `projectId` (see `getWebsiteSiteOverview()`'s
    // own `engagementProjectId` field). The service layer still
    // independently authorizes/verifies the engagement — this component
    // never trusts its own context for that.
    overview = await getWebsiteSiteOverview({ siteId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  if (overview.engagementId !== engagementId) return notFound();

  const { site, readiness, pageCount, requiredPageCount, completedRequiredPageCount, requiredQaCount, passedRequiredQaCount } = overview;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={site.name}
        breadcrumbs={[{ label: "Website Development", href: "/admin/websites" }, { label: "Engagement", href: `/admin/websites/${engagementId}` }, { label: site.name }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={websiteSiteStatusVariant(site.status)}>{site.status.replace("_", " ")}</StatusBadge>
            <StatusBadge status={launchReadinessVariant(readiness.status)}>{readiness.status.replace("_", " ")}</StatusBadge>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Platform" value={WEBSITE_PLATFORM_LABELS[site.platform]} />
        <KpiCard label="Pages" value={`${completedRequiredPageCount}/${requiredPageCount} required ready`} sub={`${pageCount} total`} />
        <KpiCard label="Required QA" value={requiredQaCount > 0 ? `${passedRequiredQaCount}/${requiredQaCount} passed` : "No QA linked"} />
        <KpiCard label="Environments" value={overview.environments.length} />
      </div>
      {readiness.status === "NOT_READY" && readiness.reasons.length > 0 ? <p className="text-xs text-muted-foreground">Blocking launch: {readiness.reasons.join(" ")}</p> : null}

      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/websites/${engagementId}/sites/${siteId}?tab=${t}`} className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab overview={overview} canManage={canManage} canDeploy={canDeploy} />
      ) : tab === "pages" ? (
        <PagesTabAsync siteId={siteId} canManage={canManage} />
      ) : tab === "environments" ? (
        <EnvironmentsTab siteId={siteId} initialItems={overview.environments} canManage={canManage} />
      ) : tab === "qa" ? (
        <QaTab engagementProjectId={overview.engagementProjectId} requiredQaCount={requiredQaCount} passedRequiredQaCount={passedRequiredQaCount} />
      ) : (
        <DeploymentsTabAsync siteId={siteId} environments={overview.environments} canDeploy={canDeploy} />
      )}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

async function PagesTabAsync({ siteId, canManage }: { siteId: string; canManage: boolean }) {
  const page = await listWebsitePages({ siteId, page: 1, limit: 100 });
  return <PagesTab siteId={siteId} initialItems={page.items} hasNextPage={page.pageInfo.hasNextPage} canManage={canManage} />;
}

async function DeploymentsTabAsync({ siteId, environments, canDeploy }: { siteId: string; environments: { id: string; type: WebsiteEnvironmentType }[]; canDeploy: boolean }) {
  const deployments = await listWebsiteDeployments({ siteId, limit: 50 });
  return <DeploymentsTab siteId={siteId} initialItems={deployments} environments={environments} canDeploy={canDeploy} />;
}
