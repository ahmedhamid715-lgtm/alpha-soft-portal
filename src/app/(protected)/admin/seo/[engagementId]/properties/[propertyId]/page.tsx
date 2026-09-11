import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getSeoPropertyOverview, listSeoKeywords } from "@/server/services/seo-engagement-service";
import { listSeoIssues, listSeoAuditRuns } from "@/server/services/seo-measurement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { SEO_FRESHNESS_LABELS } from "@/lib/seo/freshness";
import { KeywordsTab } from "./keywords-tab";
import { IssuesTab } from "./issues-tab";
import { AuditsTab } from "./audits-tab";
import { ImportTab } from "./import-tab";

export const metadata: Metadata = { title: "SEO Property" };

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SeoPropertyPage({ params, searchParams }: { params: Promise<{ engagementId: string; propertyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { engagementId, propertyId } = await params;
  const sp = await searchParams;
  const tab = (single(sp.tab) as "keywords" | "issues" | "audits" | "import" | undefined) ?? "keywords";

  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("seo.manage");
  const canManageMeasurements = context.permissions.has("seo.measurements.manage");

  let overview;
  try {
    overview = await getSeoPropertyOverview({ propertyId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  if (overview.engagementId !== engagementId) return notFound();

  const { kpis } = overview;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={overview.property.displayUrl}
        breadcrumbs={[{ label: "SEO", href: "/admin/seo" }, { label: "Engagement", href: `/admin/seo/${engagementId}` }, { label: overview.property.displayUrl }]}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <KpiCard label="Tracked" value={kpis.trackedKeywordCount} />
        <KpiCard label="Observed" value={kpis.observedKeywordCount} />
        <KpiCard label="Top 3" value={kpis.top3Count} />
        <KpiCard label="Top 10" value={kpis.top10Count} />
        <KpiCard label="Top 20" value={kpis.top20Count} />
        <KpiCard label="Avg. position" value={kpis.averagePosition ?? "—"} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{kpis.improvingCount} improving</span>
        <span>{kpis.decliningCount} declining</span>
        {kpis.openIssueCounts.critical > 0 ? <StatusBadge status="destructive">{kpis.openIssueCounts.critical} critical</StatusBadge> : null}
        {kpis.openIssueCounts.warning > 0 ? <StatusBadge status="warning">{kpis.openIssueCounts.warning} warning</StatusBadge> : null}
        <span>Data freshness: {SEO_FRESHNESS_LABELS[kpis.freshness]}</span>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(["keywords", "issues", "audits", "import"] as const).map((t) => (
          <Link key={t} href={`/admin/seo/${engagementId}/properties/${propertyId}?tab=${t}`} className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </Link>
        ))}
      </div>

      {tab === "keywords" ? (
        <KeywordsTabAsync propertyId={propertyId} canManage={canManage} canManageMeasurements={canManageMeasurements} />
      ) : tab === "issues" ? (
        <IssuesTabAsync propertyId={propertyId} canManageMeasurements={canManageMeasurements} />
      ) : tab === "audits" ? (
        <AuditsTabAsync propertyId={propertyId} canManageMeasurements={canManageMeasurements} />
      ) : (
        <ImportTab propertyId={propertyId} canManageMeasurements={canManageMeasurements} />
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

async function KeywordsTabAsync({ propertyId, canManage, canManageMeasurements }: { propertyId: string; canManage: boolean; canManageMeasurements: boolean }) {
  const page = await listSeoKeywords({ propertyId, page: 1, limit: 100 });
  return <KeywordsTab propertyId={propertyId} initialItems={page.items} canManage={canManage} canManageMeasurements={canManageMeasurements} />;
}

async function IssuesTabAsync({ propertyId, canManageMeasurements }: { propertyId: string; canManageMeasurements: boolean }) {
  const page = await listSeoIssues({ propertyId, page: 1, limit: 50 });
  return <IssuesTab propertyId={propertyId} initialItems={page.items} canManageMeasurements={canManageMeasurements} />;
}

async function AuditsTabAsync({ propertyId, canManageMeasurements }: { propertyId: string; canManageMeasurements: boolean }) {
  const runs = await listSeoAuditRuns({ propertyId, limit: 20 });
  return <AuditsTab propertyId={propertyId} initialRuns={runs} canManageMeasurements={canManageMeasurements} />;
}
