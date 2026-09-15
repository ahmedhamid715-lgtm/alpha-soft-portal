import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getLocalSeoLocationOverview, listLocalSeoKeywords, getGbpProfileForLocation } from "@/server/services/local-seo-engagement-service";
import { listLocalSeoIssues, listLocalSeoAuditRuns, listLocalListings, listLocalReviews } from "@/server/services/local-seo-measurement-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { SEO_FRESHNESS_LABELS } from "@/lib/seo/freshness";
import { ProfileTab } from "./profile-tab";
import { KeywordsTab } from "./keywords-tab";
import { ListingsTab } from "./listings-tab";
import { ReviewsTab } from "./reviews-tab";
import { IssuesTab } from "./issues-tab";
import { AuditsTab } from "./audits-tab";
import { ImportTab } from "./import-tab";

export const metadata: Metadata = { title: "Local SEO Location" };

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const TABS = ["profile", "keywords", "listings", "reviews", "issues", "audits", "import"] as const;
type Tab = (typeof TABS)[number];

export default async function LocalSeoLocationPage({ params, searchParams }: { params: Promise<{ engagementId: string; locationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { engagementId, locationId } = await params;
  const sp = await searchParams;
  const tab = (single(sp.tab) as Tab | undefined) && TABS.includes(single(sp.tab) as Tab) ? (single(sp.tab) as Tab) : "profile";

  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("local_seo.manage");
  const canManageMeasurements = context.permissions.has("local_seo.measurements.manage");

  let overview;
  try {
    overview = await getLocalSeoLocationOverview({ locationId });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  if (overview.engagementId !== engagementId) return notFound();

  const { location, kpis } = overview;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={location.businessName} breadcrumbs={[{ label: "Local SEO", href: "/admin/local-seo" }, { label: "Engagement", href: `/admin/local-seo/${engagementId}` }, { label: location.businessName }]} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <KpiCard label="Tracked" value={kpis.trackedKeywordCount} />
        <KpiCard label="Observed" value={kpis.observedKeywordCount} />
        <KpiCard label="Local Pack Top 3" value={kpis.localPackTop3Count} />
        <KpiCard label="Local Pack Top 10" value={kpis.localPackTop10Count} />
        <KpiCard label="Avg. position" value={kpis.averagePosition ?? "—"} />
        <KpiCard label="Listings consistent" value={kpis.listingConsistencyPercent !== null ? `${kpis.listingConsistencyPercent}%` : "—"} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{kpis.improvingCount} improving</span>
        <span>{kpis.decliningCount} declining</span>
        {kpis.openIssueCounts.critical > 0 ? <StatusBadge status="destructive">{kpis.openIssueCounts.critical} critical</StatusBadge> : null}
        {kpis.openIssueCounts.warning > 0 ? <StatusBadge status="warning">{kpis.openIssueCounts.warning} warning</StatusBadge> : null}
        <span>{kpis.listingCount} listing(s)</span>
        <span>
          {kpis.reviewCount} review(s){kpis.averageRating !== null ? `, ${kpis.averageRating}★ avg` : ""}
        </span>
        <span>Data freshness: {SEO_FRESHNESS_LABELS[kpis.freshness]}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/local-seo/${engagementId}/locations/${locationId}?tab=${t}`} className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </Link>
        ))}
      </div>

      {tab === "profile" ? (
        <ProfileTabAsync locationId={locationId} canManage={canManage} />
      ) : tab === "keywords" ? (
        <KeywordsTabAsync locationId={locationId} canManage={canManage} canManageMeasurements={canManageMeasurements} />
      ) : tab === "listings" ? (
        <ListingsTabAsync locationId={locationId} location={location} canManageMeasurements={canManageMeasurements} />
      ) : tab === "reviews" ? (
        <ReviewsTabAsync locationId={locationId} canManageMeasurements={canManageMeasurements} />
      ) : tab === "issues" ? (
        <IssuesTabAsync locationId={locationId} canManageMeasurements={canManageMeasurements} />
      ) : tab === "audits" ? (
        <AuditsTabAsync locationId={locationId} canManageMeasurements={canManageMeasurements} />
      ) : (
        <ImportTab locationId={locationId} canManageMeasurements={canManageMeasurements} />
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

async function ProfileTabAsync({ locationId, canManage }: { locationId: string; canManage: boolean }) {
  const profile = await getGbpProfileForLocation({ locationId });
  return <ProfileTab locationId={locationId} initialProfile={profile} canManage={canManage} />;
}

async function KeywordsTabAsync({ locationId, canManage, canManageMeasurements }: { locationId: string; canManage: boolean; canManageMeasurements: boolean }) {
  const page = await listLocalSeoKeywords({ locationId, page: 1, limit: 100 });
  return <KeywordsTab locationId={locationId} initialItems={page.items} canManage={canManage} canManageMeasurements={canManageMeasurements} />;
}

async function ListingsTabAsync({ locationId, location, canManageMeasurements }: { locationId: string; location: { businessName: string; addressLine1: string | null; city: string | null; postalCode: string | null; phone: string | null }; canManageMeasurements: boolean }) {
  const listings = await listLocalListings({ locationId });
  return <ListingsTab locationId={locationId} initialItems={listings} canonical={location} canManageMeasurements={canManageMeasurements} />;
}

async function ReviewsTabAsync({ locationId, canManageMeasurements }: { locationId: string; canManageMeasurements: boolean }) {
  const page = await listLocalReviews({ locationId, page: 1, limit: 50 });
  return <ReviewsTab locationId={locationId} initialItems={page.items} canManageMeasurements={canManageMeasurements} />;
}

async function IssuesTabAsync({ locationId, canManageMeasurements }: { locationId: string; canManageMeasurements: boolean }) {
  const page = await listLocalSeoIssues({ locationId, page: 1, limit: 50 });
  return <IssuesTab locationId={locationId} initialItems={page.items} canManageMeasurements={canManageMeasurements} />;
}

async function AuditsTabAsync({ locationId, canManageMeasurements }: { locationId: string; canManageMeasurements: boolean }) {
  const runs = await listLocalSeoAuditRuns({ locationId, limit: 20 });
  return <AuditsTab locationId={locationId} initialRuns={runs} canManageMeasurements={canManageMeasurements} />;
}
