import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getDealWithRelations, listDealHistory } from "@/server/services/crm-deal-service";
import { getPipeline } from "@/server/services/crm-pipeline-service";
import { listStagesForPipeline } from "@/server/services/crm-pipeline-stage-service";
import { listContactsForCompany } from "@/server/services/crm-contact-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { listProposals } from "@/server/services/crm-proposal-service";
import { listContracts } from "@/server/services/crm-contract-service";
import { listOnboardings, checkOnboardingEligibility } from "@/server/services/crm-client-onboarding-service";
import { listAssignableUsers as listOnboardingAssignableUsers } from "@/server/services/crm-shared";
import { toAppError } from "@/lib/errors/app-error";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { DealLifecycleControls } from "@/components/crm/pipeline/deal-lifecycle-controls";
import { DealEditForm } from "@/components/crm/pipeline/deal-edit-form";
import { DealOwnerControl } from "@/components/crm/pipeline/deal-owner-control";
import { LogDealNoteForm } from "@/components/crm/pipeline/log-deal-note-form";
import { DealHistoryList } from "@/components/crm/pipeline/deal-history-list";
import { Button } from "@/components/ui/button";
import { proposalStatusVariant, contractStatusVariant } from "@/components/crm/proposals/proposal-status";
import { onboardingStatusVariant } from "@/components/crm/onboarding/onboarding-status";
import { StartOnboardingForm } from "@/components/crm/onboarding/start-onboarding-form";

export const metadata: Metadata = { title: "Deal" };

/** A single `CrmDeal`'s detail view — `crm.pipeline.read` to view, `crm.pipeline.manage` to edit/move/win/lose/reopen/reassign/log a note. */
export default async function CrmDealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.pipeline.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Deal" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.pipeline.read permission." />
      </div>
    );
  }

  const canManage = context.permissions.has("crm.pipeline.manage");
  const canSeeProposals = context.permissions.has("crm.proposal.read");
  const canManageProposals = context.permissions.has("crm.proposal.manage");
  const canSeeContracts = context.permissions.has("crm.contract.read");
  const canSeeOnboarding = context.permissions.has("crm.onboarding.read");
  const canManageOnboarding = context.permissions.has("crm.onboarding.manage");

  // Stage 1 — everything needing only the route `id`/permissions (not
  // the resolved deal's own `pipelineId`/`companyId`) starts alongside
  // `getDealWithRelations()`. Flagged by the Build 22 performance
  // review: `listAssignableUsers()`/`listDealHistory()`/`listProposals()`/
  // `listContracts()` previously all waited on the deal fetch first for
  // no real reason.
  const [deal, users, history, proposals, contracts, dealOnboardings] = await Promise.all([
    getDealWithRelations({ dealId: id }).catch((error) => {
      if (toAppError(error).code === "NOT_FOUND") notFound();
      throw error;
    }),
    canManage ? listAssignableUsers() : Promise.resolve([]),
    listDealHistory({ dealId: id, limit: 25 }),
    canSeeProposals ? listProposals({ dealId: id }) : Promise.resolve([]),
    canSeeContracts ? listContracts({ dealId: id }) : Promise.resolve([]),
    // Filtered server-side by `dealId` (Codex Performance Engineer
    // review) — this used to fetch up to 200 tenant-wide onboardings
    // and their full relations, then filter down to this one deal in
    // memory, which got slower with every OTHER onboarding in the
    // tenant regardless of this page's own needs.
    canSeeOnboarding ? listOnboardings({ dealId: id }) : Promise.resolve([]),
  ]);

  // The onboarding-eligibility check and its own optional assignee list
  // genuinely depend on the deal's own WON status (only worth resolving
  // for a WON deal with no existing onboarding at all — every other case
  // renders nothing here) — kept out of Stage 1 above deliberately, since
  // most deal views (any deal not yet WON) never need either.
  const showStartOnboarding = canManageOnboarding && deal.status === "WON" && dealOnboardings.every((o) => o.status === "CANCELLED");
  const [eligibility, onboardingAssignableUsers] = await Promise.all([
    showStartOnboarding ? checkOnboardingEligibility({ dealId: id }) : Promise.resolve(null),
    showStartOnboarding ? listOnboardingAssignableUsers() : Promise.resolve([]),
  ]);

  // Stage 2 — genuinely depends on the now-resolved deal.
  const [pipeline, stages, companyContacts] = await Promise.all([
    getPipeline({ pipelineId: deal.pipelineId }),
    listStagesForPipeline({ pipelineId: deal.pipelineId, status: "ACTIVE" }),
    canManage ? listContactsForCompany({ companyId: deal.companyId }) : Promise.resolve([]),
  ]);

  const stage = stages.find((s) => s.id === deal.stageId);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={deal.title}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Pipeline", href: `/admin/crm/pipeline?pipeline=${deal.pipelineId}` }, { label: deal.title }]}
        actions={<StatusBadge status={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "info"}>{deal.status}</StatusBadge>}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pipeline</span>
              <Link href={`/admin/crm/pipeline?pipeline=${pipeline.id}`} className="hover:underline">
                {pipeline.name}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Stage</span>
              <span>{stage?.name ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Company</span>
              <span className="flex items-center gap-2">
                <Link href={`/admin/crm/companies/${deal.company.id}`} className="hover:underline">
                  {deal.company.name}
                </Link>
                <Link href={`/admin/crm/customers/${deal.company.id}`} className="text-xs text-link hover:underline">
                  (Customer 360)
                </Link>
              </span>
            </div>
            {deal.primaryContact ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Primary contact</span>
                <Link href={`/admin/crm/contacts/${deal.primaryContact.id}`} className="hover:underline">
                  {deal.primaryContact.firstName} {deal.primaryContact.lastName}
                </Link>
              </div>
            ) : null}
            {deal.sourceLeadId ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Source lead</span>
                <Link href={`/admin/crm/leads/${deal.sourceLeadId}`} className="hover:underline">
                  View lead
                </Link>
              </div>
            ) : null}
            <div className="flex items-center justify-between pt-2">
              <span className="text-muted-foreground">Value</span>
              <span className="font-semibold tabular-nums">{formatMoney(deal.valueMinorUnits, deal.currency)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Probability</span>
              <span>{deal.probability !== null ? `${deal.probability}%` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Expected close</span>
              <span>{deal.expectedCloseDate ? formatInTimeZone(deal.expectedCloseDate, "UTC") : "—"}</span>
            </div>
            {deal.status === "WON" && deal.wonAt ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Won</span>
                <span>{formatInTimeZone(deal.wonAt, "UTC")}</span>
              </div>
            ) : null}
            {deal.status === "LOST" && deal.lostAt ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Lost</span>
                  <span>{formatInTimeZone(deal.lostAt, "UTC")}</span>
                </div>
                {deal.lossReason ? (
                  <div className="flex flex-col gap-1 pt-1">
                    <span className="text-muted-foreground">Loss reason</span>
                    <p className="text-foreground">{deal.lossReason}</p>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex items-center justify-between pt-2">
              <span className="text-muted-foreground">Owner</span>
              <span>{deal.assignedToUser?.name ?? "Unassigned"}</span>
            </div>
          </CardContent>
        </Card>

        {canManage ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="flex flex-col gap-3">
                <span className="text-sm text-muted-foreground">Lifecycle</span>
                <DealLifecycleControls deal={deal} stages={stages} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-3">
                <span className="text-sm text-muted-foreground">Owner</span>
                <DealOwnerControl dealId={deal.id} assignedToUserId={deal.assignedToUserId} users={users} />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </section>

      {canManage ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Edit" />
          <Card>
            <CardContent>
              <DealEditForm deal={deal} companyContacts={companyContacts} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      {canSeeProposals ? (
        <section className="flex flex-col gap-4">
          <SectionHeader
            title="Proposals"
            description="Quotes sent for this deal — Deal → Proposal → Accepted Proposal → Contract."
            actions={
              canManageProposals ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/crm/proposals/new?dealId=${deal.id}`}>New proposal</Link>
                </Button>
              ) : null
            }
          />
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No proposals yet for this deal.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {proposals.map((proposal) => (
                <Link key={proposal.id} href={`/admin/crm/proposals/${proposal.id}`} className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted/30">
                  <span className="font-medium">{proposal.proposalNumber}</span>
                  <StatusBadge status={proposalStatusVariant(proposal.status)}>{proposal.status}</StatusBadge>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {canSeeContracts && contracts.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Contracts" description="Commercial agreements resulting from this deal." />
          <div className="flex flex-col gap-2">
            {contracts.map((contract) => (
              <Link key={contract.id} href={`/admin/crm/contracts/${contract.id}`} className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted/30">
                <span className="font-medium">{contract.contractNumber}</span>
                <StatusBadge status={contractStatusVariant(contract.status)}>{contract.status}</StatusBadge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {canSeeOnboarding && dealOnboardings.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Onboarding" description="Client onboarding engagements started from this deal." />
          <div className="flex flex-col gap-2">
            {dealOnboardings.map((onboarding) => (
              <Link key={onboarding.id} href={`/admin/crm/onboarding/${onboarding.id}`} className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted/30">
                <span className="font-medium">{onboarding.linkedOrganization.displayName}</span>
                <StatusBadge status={onboardingStatusVariant(onboarding.status)}>{onboarding.status.replace("_", " ")}</StatusBadge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {showStartOnboarding && eligibility ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Start Onboarding" description="Convert this won deal into an operational client onboarding engagement." />
          <Card>
            <CardContent>
              {eligibility.eligible ? (
                <StartOnboardingForm dealId={deal.id} users={onboardingAssignableUsers} />
              ) : (
                <p className="text-sm text-muted-foreground">{eligibility.reason}</p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="History" description="Business chronology for this deal — stage moves, value/probability changes, won/lost/reopened, and notes." />
        {canManage ? (
          <Card>
            <CardContent>
              <LogDealNoteForm dealId={deal.id} />
            </CardContent>
          </Card>
        ) : null}
        <DealHistoryList entries={history.items} />
        {history.items.length === 0 ? null : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <History className="size-3.5" aria-hidden="true" /> Showing the most recent {history.items.length} of {history.pageInfo.totalCount} history entries.
          </p>
        )}
      </section>
    </div>
  );
}
