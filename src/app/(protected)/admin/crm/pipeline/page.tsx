import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Settings, KanbanSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listPipelines } from "@/server/services/crm-pipeline-service";
import { listStagesForPipeline } from "@/server/services/crm-pipeline-stage-service";
import { listOpenDealsForBoard } from "@/server/services/crm-deal-service";
import { getForecastSummary } from "@/server/services/crm-deal-forecast-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { listCompanies } from "@/server/services/crm-company-service";
import { PipelineSelector } from "@/components/crm/pipeline/pipeline-selector";
import { PipelineBoard } from "@/components/crm/pipeline/pipeline-board";
import { ForecastSummary } from "@/components/crm/pipeline/forecast-summary";
import { NewDealForm } from "@/components/crm/pipeline/new-deal-form";
import type { CrmDealWithRelations } from "@/server/repositories/crm-deal-repository";

export const metadata: Metadata = { title: "Sales Pipeline" };

/**
 * The sales pipeline board (Build 20 — Roadmap Module 14) —
 * `crm.pipeline.read`. Alpha Page Rankers' own internal pipeline — see
 * docs/architecture/sales-pipeline.md. Reuses `/admin/crm`'s own
 * platform-CRM framing; this page never exposes a customer
 * organization's own data.
 */
export default async function CrmPipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.pipeline.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Sales Pipeline" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Pipeline" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.pipeline.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const requestedPipelineId = single(sp.pipeline);

  const pipelines = await listPipelines({ status: "ACTIVE" });
  if (pipelines.length === 0) {
    const canManage = context.permissions.has("crm.pipeline.manage");
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Sales Pipeline" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Pipeline" }]} />
        <EmptyState
          icon={KanbanSquare}
          title="No pipelines configured yet"
          description={canManage ? "Create a pipeline in settings to start tracking deals." : "Ask a platform administrator to configure a pipeline."}
          action={
            canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/crm/settings">Go to settings</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  // Derived from the already-loaded `pipelines` list rather than a second
  // `getDefaultPipeline()` call — that service re-ran the identical
  // organization/ACTIVE query this page had just issued (a real,
  // redundant round-trip found by Codex's own Build 20 Phase 8
  // performance review).
  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const selectedPipeline = pipelines.find((p) => p.id === requestedPipelineId) ?? defaultPipeline;

  const canManage = context.permissions.has("crm.pipeline.manage");
  const [stages, deals, forecast, companies, users] = await Promise.all([
    listStagesForPipeline({ pipelineId: selectedPipeline.id, status: "ACTIVE" }),
    listOpenDealsForBoard({ pipelineId: selectedPipeline.id }),
    getForecastSummary({ pipelineId: selectedPipeline.id }),
    canManage ? listCompanies({ limit: 100, status: "ACTIVE" }) : null,
    canManage ? listAssignableUsers() : null,
  ]);

  const dealsByStage = new Map<string, CrmDealWithRelations[]>();
  for (const deal of deals) dealsByStage.set(deal.stageId, [...(dealsByStage.get(deal.stageId) ?? []), deal]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Sales Pipeline"
        description="Alpha Page Rankers' own sales deals, from open through won or lost. Never a customer organization's own data."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Pipeline" }]}
        actions={
          <>
            <PipelineSelector pipelines={pipelines} selectedPipelineId={selectedPipeline.id} />
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/crm/settings">
                  <Settings className="size-4" aria-hidden="true" />
                  Pipeline settings
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <ForecastSummary summary={forecast} />

      {canManage && companies && users ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="New deal" />
          <Card>
            <CardContent>
              <NewDealForm pipelineId={selectedPipeline.id} companies={companies.items} users={users} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Board" />
        <PipelineBoard stages={stages} dealsByStage={dealsByStage} canManage={canManage} />
      </section>
    </div>
  );
}
