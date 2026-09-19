import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getGhlWorkspaceOverview, getGhlEngagement } from "@/server/services/ghl-engagement-service";
import { listGhlAssets, listGhlIntegrationRequirements, listGhlImportBatches } from "@/server/services/ghl-asset-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { ghlWorkspaceStatusVariant, ghlReadinessVariant } from "@/components/ghl/ghl-status";
import { OverviewTab } from "./overview-tab";
import { AssetsTab } from "./assets-tab";
import { IntegrationsTab } from "./integrations-tab";
import { QaTab } from "./qa-tab";
import { ImportTab } from "./import-tab";

export const metadata: Metadata = { title: "GHL Workspace" };

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const TABS = ["overview", "assets", "integrations", "qa", "import"] as const;
type Tab = (typeof TABS)[number];

export default async function GhlWorkspacePage({ params, searchParams }: { params: Promise<{ engagementId: string; workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { engagementId, workspaceId } = await params;
  const sp = await searchParams;
  const tab = (single(sp.tab) as Tab | undefined) && TABS.includes(single(sp.tab) as Tab) ? (single(sp.tab) as Tab) : "overview";

  const context = await resolvePlatformContext();
  const canManage = context.permissions.has("ghl_automation.manage");
  const canLaunch = context.permissions.has("ghl_automation.launch");

  // Codex Performance Engineer finding PERF-ECOM-07 (Build 33) applied
  // proactively here from the start — the engagement lookup (needed
  // only by the QA tab, for its own `projectId`) and the active tab's
  // own assets/integrations/import fetch are all started CONCURRENTLY
  // with the overview fetch, never a waterfall; the engagement call is
  // skipped entirely on every tab except QA.
  const overviewPromise = getGhlWorkspaceOverview({ workspaceId });
  const engagementPromise = tab === "qa" ? getGhlEngagement({ engagementId }) : Promise.resolve(null);
  const assetsPromise = tab === "assets" ? listGhlAssets({ workspaceId, page: 1, limit: 100 }) : null;
  const integrationsPromise = tab === "integrations" ? listGhlIntegrationRequirements({ workspaceId }) : null;
  const importBatchesPromise = tab === "import" ? listGhlImportBatches({ workspaceId, limit: 50 }) : null;
  // A no-op `.catch()` attached to the ORIGINAL promise (not reassigned)
  // marks it handled for Node's unhandled-rejection tracking in the
  // not-found path below, where a promise may be created but never
  // awaited — it still rejects for real when actually awaited later.
  assetsPromise?.catch(() => undefined);
  integrationsPromise?.catch(() => undefined);
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

  const { workspace, readiness, assetCount, requiredAssetCount, completedRequiredAssetCount, qaFailedRequiredAssetCount, requiredIntegrationCount, confirmedRequiredIntegrationCount, requiredQaCount, passedRequiredQaCount } = overview;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={workspace.name}
        breadcrumbs={[{ label: "GHL Automation", href: "/admin/ghl" }, { label: "Engagement", href: `/admin/ghl/${engagementId}` }, { label: workspace.name }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={ghlWorkspaceStatusVariant(workspace.status)}>{workspace.status.replace("_", " ")}</StatusBadge>
            <StatusBadge status={ghlReadinessVariant(readiness.status)}>{readiness.status.replace("_", " ")}</StatusBadge>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Assets" value={requiredAssetCount > 0 ? `${completedRequiredAssetCount}/${requiredAssetCount} required ready` : "No required assets"} sub={`${assetCount} total${qaFailedRequiredAssetCount > 0 ? ` · ${qaFailedRequiredAssetCount} QA failed` : ""}`} />
        <KpiCard label="Integrations" value={requiredIntegrationCount > 0 ? `${confirmedRequiredIntegrationCount}/${requiredIntegrationCount} confirmed` : "None required"} />
        <KpiCard label="Required QA" value={requiredQaCount > 0 ? `${passedRequiredQaCount}/${requiredQaCount} passed` : "No QA linked"} />
        <KpiCard label="Handoff" value={workspace.handoffStatus.replace("_", " ")} />
      </div>
      {readiness.status === "NOT_READY" && readiness.reasons.length > 0 ? <p className="text-xs text-muted-foreground">Blocking go-live: {readiness.reasons.join(" ")}</p> : null}

      <div className="flex gap-2 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/ghl/${engagementId}/workspaces/${workspaceId}?tab=${t}`} className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab overview={overview} canManage={canManage} canLaunch={canLaunch} />
      ) : tab === "assets" && assetsPromise ? (
        <AssetsTabResolved promise={assetsPromise} workspaceId={workspaceId} canManage={canManage} />
      ) : tab === "integrations" && integrationsPromise ? (
        <IntegrationsTabResolved promise={integrationsPromise} workspaceId={workspaceId} canManage={canManage} />
      ) : tab === "qa" ? (
        <QaTab engagementProjectId={engagement?.projectId ?? null} requiredQaCount={requiredQaCount} passedRequiredQaCount={passedRequiredQaCount} />
      ) : importBatchesPromise ? (
        <ImportTabResolved promise={importBatchesPromise} workspaceId={workspaceId} canManage={canManage} />
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

async function AssetsTabResolved({ promise, workspaceId, canManage }: { promise: ReturnType<typeof listGhlAssets>; workspaceId: string; canManage: boolean }) {
  const page = await promise;
  return <AssetsTab workspaceId={workspaceId} initialItems={page.items} hasNextPage={page.pageInfo.hasNextPage} canManage={canManage} />;
}

async function IntegrationsTabResolved({ promise, workspaceId, canManage }: { promise: ReturnType<typeof listGhlIntegrationRequirements>; workspaceId: string; canManage: boolean }) {
  const items = await promise;
  return <IntegrationsTab workspaceId={workspaceId} initialItems={items} canManage={canManage} />;
}

async function ImportTabResolved({ promise, workspaceId, canManage }: { promise: ReturnType<typeof listGhlImportBatches>; workspaceId: string; canManage: boolean }) {
  const batches = await promise;
  return <ImportTab workspaceId={workspaceId} initialBatches={batches} canManage={canManage} />;
}
