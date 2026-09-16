import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getEcommerceStoreOverview, getEcommerceEngagement } from "@/server/services/ecommerce-engagement-service";
import { listEcommerceProducts, listEcommerceImportBatches } from "@/server/services/ecommerce-catalog-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { ecommerceStoreStatusVariant, ecommerceReadinessVariant, ECOMMERCE_PLATFORM_LABELS } from "@/components/ecommerce/ecommerce-status";
import { OverviewTab } from "./overview-tab";
import { CatalogTab } from "./catalog-tab";
import { ConfigurationTab } from "./configuration-tab";
import { QaTab } from "./qa-tab";
import { ImportTab } from "./import-tab";

export const metadata: Metadata = { title: "E-Commerce Store" };

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const TABS = ["overview", "catalog", "configuration", "qa", "import"] as const;
type Tab = (typeof TABS)[number];

export default async function EcommerceStorePage({ params, searchParams }: { params: Promise<{ engagementId: string; storeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { engagementId, storeId } = await params;
  const sp = await searchParams;
  const tab = (single(sp.tab) as Tab | undefined) && TABS.includes(single(sp.tab) as Tab) ? (single(sp.tab) as Tab) : "overview";

  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("ecommerce_development.manage");
  const canLaunch = context.permissions.has("ecommerce_development.launch");

  // Codex Performance Engineer finding PERF-ECOM-07 — the engagement
  // lookup (needed only by the QA tab, for its own `projectId`) and the
  // active tab's own catalog/import fetch are both started CONCURRENTLY
  // with the overview fetch, not awaited one-after-another in a
  // waterfall; the engagement call is skipped entirely on every tab
  // except QA, where it used to run unconditionally on every tab.
  const overviewPromise = getEcommerceStoreOverview({ storeId });
  const engagementPromise = tab === "qa" ? getEcommerceEngagement({ engagementId }) : Promise.resolve(null);
  const catalogPromise = tab === "catalog" ? listEcommerceProducts({ storeId, page: 1, limit: 100 }) : null;
  const importBatchesPromise = tab === "import" ? listEcommerceImportBatches({ storeId, limit: 50 }) : null;
  // A no-op `.catch()` attached to the ORIGINAL promise (not reassigned)
  // marks it handled for Node's unhandled-rejection tracking in the
  // not-found path below, where this promise is created but never
  // awaited — it still rejects for real when actually awaited later.
  catalogPromise?.catch(() => undefined);
  importBatchesPromise?.catch(() => undefined);

  let overview;
  let engagement;
  try {
    [overview, engagement] = await Promise.all([overviewPromise, engagementPromise]);
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  if (overview.engagementId !== engagementId) return notFound();

  const { store, readiness, productCount, requiredProductCount, completedRequiredProductCount, requiredQaCount, passedRequiredQaCount } = overview;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={store.name}
        breadcrumbs={[{ label: "E-Commerce Development", href: "/admin/ecommerce" }, { label: "Engagement", href: `/admin/ecommerce/${engagementId}` }, { label: store.name }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={ecommerceStoreStatusVariant(store.status)}>{store.status.replace("_", " ")}</StatusBadge>
            <StatusBadge status={ecommerceReadinessVariant(readiness.status)}>{readiness.status.replace("_", " ")}</StatusBadge>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Platform" value={ECOMMERCE_PLATFORM_LABELS[store.platform]} />
        <KpiCard label="Products" value={requiredProductCount > 0 ? `${completedRequiredProductCount}/${requiredProductCount} required ready` : "No required products"} sub={`${productCount} total`} />
        <KpiCard label="Required QA" value={requiredQaCount > 0 ? `${passedRequiredQaCount}/${requiredQaCount} passed` : "No QA linked"} />
        <KpiCard label="Currency" value={store.currency ?? "Not set"} />
      </div>
      {readiness.status === "NOT_READY" && readiness.reasons.length > 0 ? <p className="text-xs text-muted-foreground">Blocking launch: {readiness.reasons.join(" ")}</p> : null}
      {overview.websiteReadinessUnavailable ? <p className="text-xs text-muted-foreground">Linked website readiness is unavailable — you don&apos;t hold the website_development.read permission.</p> : null}

      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/ecommerce/${engagementId}/stores/${storeId}?tab=${t}`} className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab overview={overview} canManage={canManage} canLaunch={canLaunch} />
      ) : tab === "catalog" && catalogPromise ? (
        <CatalogTabResolved promise={catalogPromise} storeId={storeId} canManage={canManage} />
      ) : tab === "configuration" ? (
        <ConfigurationTab store={store} canManage={canManage} />
      ) : tab === "qa" ? (
        <QaTab engagementProjectId={engagement?.projectId ?? null} requiredQaCount={requiredQaCount} passedRequiredQaCount={passedRequiredQaCount} />
      ) : importBatchesPromise ? (
        <ImportTabResolved promise={importBatchesPromise} storeId={storeId} canManage={canManage} />
      ) : null}
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

async function CatalogTabResolved({ promise, storeId, canManage }: { promise: ReturnType<typeof listEcommerceProducts>; storeId: string; canManage: boolean }) {
  const page = await promise;
  return <CatalogTab storeId={storeId} initialItems={page.items} hasNextPage={page.pageInfo.hasNextPage} canManage={canManage} />;
}

async function ImportTabResolved({ promise, storeId, canManage }: { promise: ReturnType<typeof listEcommerceImportBatches>; storeId: string; canManage: boolean }) {
  const batches = await promise;
  return <ImportTab storeId={storeId} initialBatches={batches} canManage={canManage} />;
}
