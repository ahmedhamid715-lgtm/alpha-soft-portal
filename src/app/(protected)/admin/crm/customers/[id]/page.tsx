import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Users, Briefcase, Package, Rocket, CreditCard, FileText, Activity as ActivityIcon, FolderKanban, LifeBuoy, MessageSquare, HeartPulse } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getCustomer360, type Customer360ViewModel } from "@/server/services/customer-360-service";
import { toAppError } from "@/lib/errors/app-error";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { CUSTOMER_LIFECYCLE_STAGE_LABELS } from "@/lib/crm/customer-360";
import { lifecycleStageVariant } from "@/components/crm/customer-360/customer-status";
import { proposalStatusVariant, contractStatusVariant } from "@/components/crm/proposals/proposal-status";
import { onboardingStatusVariant } from "@/components/crm/onboarding/onboarding-status";
import { Customer360Tabs, type Customer360Tab } from "@/components/crm/customer-360/customer-360-tabs";
import { CustomerActivityTab } from "@/components/crm/customer-360/customer-activity-tab";
import { ClientSuccessHealthTab } from "@/components/crm/client-success/client-success-health-tab";
import { getClientSuccessHealth } from "@/server/services/crm-client-success-health-service";
import { listRenewalsForCompany, listExpansionsForCompany } from "@/server/services/crm-client-success-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { CLIENT_SUCCESS_RENEWAL_OPEN_STATUSES, type CrmClientSuccessRenewalWithRelations } from "@/server/repositories/crm-client-success-renewal-repository";
import type { CrmClientSuccessExpansionWithRelations } from "@/server/repositories/crm-client-success-expansion-repository";
import { listProjectsForCustomer360, type Customer360ProjectSummary } from "@/server/services/project-customer-360-service";
import { ProjectProgressDisplay } from "@/components/projects/project-progress-display";
import { projectStatusVariant, projectPriorityVariant } from "@/components/projects/project-status";
import { customerServiceStatusVariant, SERVICE_CATEGORY_LABELS } from "@/components/services/service-status";
import type { SeoServicePerformanceInput, LocalSeoServicePerformanceInput, WebsiteServicePerformanceInput, EcommerceServicePerformanceInput } from "@/lib/crm/client-success";

export const metadata: Metadata = { title: "Customer 360" };

function fmtDate(date: Date | null | undefined): string {
  // "UTC", `{ hour: undefined, minute: undefined }` — the same date-only
  // convention every other admin page already uses (see
  // `formatInTimeZone()`'s own callers); `dateStyle` cannot be mixed with
  // that helper's own default year/month/day/hour/minute component
  // options (an ECMA-402 `Intl.DateTimeFormat` restriction — the two
  // option shapes are mutually exclusive, and mixing them throws).
  return date ? formatInTimeZone(date, "UTC", { hour: undefined, minute: undefined }) : "—";
}

/**
 * Customer 360 (Build 24 — Roadmap Module 18) — the authoritative cross-
 * domain customer view, composed (never duplicated) from Builds 19–23 +
 * platform billing. See docs/architecture/customer-360.md.
 *
 * `crm.read` is the floor to view this page at all (the customer
 * identity/overview IS CRM data — same permission the plain `CrmCompany`
 * detail page already requires); every section beyond that is
 * independently gated by ITS OWN existing permission inside
 * `getCustomer360()` — this page never re-implements authorization, it
 * only decides what to RENDER based on which sections `getCustomer360()`
 * actually returned data for.
 */
export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Customer" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing a customer's 360° workspace requires the crm.read permission." />
      </div>
    );
  }

  let view: Customer360ViewModel;
  try {
    view = await getCustomer360({ companyId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const canSeeClientSuccess = context.permissions.has("crm.client_success.read");
  const canManageClientSuccess = context.permissions.has("crm.client_success.manage");
  const [clientSuccessHealth, renewals, expansions, assignableUsers] = canSeeClientSuccess
    ? await Promise.all([getClientSuccessHealth({ companyId: id }, view), listRenewalsForCompany({ companyId: id }), listExpansionsForCompany({ companyId: id }), listAssignableUsers()])
    : [null, [] as CrmClientSuccessRenewalWithRelations[], [] as CrmClientSuccessExpansionWithRelations[], []];

  // Build 27 — Project Management. Source domain owns the read (see
  // `project-customer-360-service.ts`'s own top comment); this page only
  // decides whether to render it. No projects are possible before the
  // company has converted to a real customer Organization.
  const canSeeProjects = context.permissions.has("delivery_projects.read");
  const projects: Customer360ProjectSummary[] = canSeeProjects && view.linkedOrganization ? await listProjectsForCustomer360(view.linkedOrganization.id) : [];

  const tabs: Customer360Tab[] = [
    { value: "overview", label: "Overview", content: <OverviewTab view={view} /> },
    { value: "contacts", label: "Contacts", content: <ContactsTab view={view} /> },
    { value: "services", label: "Services", content: <ServicesTab view={view} /> },
    { value: "sales", label: "Sales", content: <SalesTab view={view} /> },
    { value: "onboarding", label: "Onboarding", content: <OnboardingTab view={view} /> },
    { value: "billing", label: "Billing", content: <BillingTab view={view} /> },
    {
      value: "client-success",
      label: "Client Success",
      content: canSeeClientSuccess && clientSuccessHealth ? (
        <ClientSuccessHealthTab
          companyId={id}
          health={clientSuccessHealth.health}
          churnRisk={clientSuccessHealth.churnRisk}
          csProfile={clientSuccessHealth.csProfile}
          assignableUsers={assignableUsers}
          renewals={renewals}
          eligibleContracts={(view.contracts ?? []).filter((c) => c.status === "ACTIVE" && !renewals.some((r) => r.contractId === c.id && CLIENT_SUCCESS_RENEWAL_OPEN_STATUSES.includes(r.status)))}
          expansions={expansions}
          dealsForHandoff={(view.deals ?? []).filter((d) => d.status === "OPEN").map((d) => ({ id: d.id, title: d.title }))}
          canManage={canManageClientSuccess}
        />
      ) : (
        <EmptyState icon={ShieldAlert} title="No access" description="Viewing Client Success requires the crm.client_success.read permission." />
      ),
    },
    { value: "activity", label: "Activity", content: <ActivityTab view={view} /> },
    { value: "documents", label: "Documents", content: <DocumentsTab view={view} /> },
    {
      value: "projects",
      label: "Projects",
      content: canSeeProjects ? (
        <ProjectsTab projects={projects} hasLinkedOrganization={view.linkedOrganization !== null} />
      ) : (
        <EmptyState icon={FolderKanban} title="No access" description="Viewing projects requires the delivery_projects.read permission." />
      ),
    },
    { value: "more", label: "Support / Conversations", content: <FutureDomainsTab /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={view.company.name}
        description={view.linkedOrganization ? `Linked to ${view.linkedOrganization.displayName}` : view.company.domain ?? undefined}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Companies", href: "/admin/crm/companies" }, { label: view.company.name, href: `/admin/crm/companies/${view.company.id}` }, { label: "Customer 360" }]}
        actions={<StatusBadge status={lifecycleStageVariant(view.lifecycleStage)}>{CUSTOMER_LIFECYCLE_STAGE_LABELS[view.lifecycleStage]}</StatusBadge>}
      />

      <CustomerHeaderCard view={view} />

      <Customer360Tabs tabs={tabs} />
    </div>
  );
}

function CustomerHeaderCard({ view }: { view: Customer360ViewModel }) {
  const latestContract = view.contracts?.[0] ?? null;
  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Account owner</span>
          <span className="font-medium">{view.accountOwner?.name ?? "Unassigned"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Primary contact</span>
          <span className="font-medium">{view.primaryContact ? `${view.primaryContact.firstName} ${view.primaryContact.lastName}` : "—"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Contract</span>
          {latestContract ? <StatusBadge status={contractStatusVariant(latestContract.status)}>{latestContract.status}</StatusBadge> : <span>—</span>}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Onboarding</span>
          {view.currentOnboardingDetail ? <StatusBadge status={onboardingStatusVariant(view.currentOnboardingDetail.onboarding.status)}>{view.currentOnboardingDetail.onboarding.status.replace("_", " ")}</StatusBadge> : <span>—</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewTab({ view }: { view: Customer360ViewModel }) {
  const wonDeals = view.deals?.filter((d) => d.status === "WON") ?? [];
  const openDeals = view.deals?.filter((d) => d.status === "OPEN") ?? [];
  const wonValue = wonDeals.reduce((sum, d) => sum + d.valueMinorUnits, 0);
  const currency = wonDeals[0]?.currency ?? view.deals?.[0]?.currency ?? "USD";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {view.deals !== null ? <MetricCard label="Won deal value" value={formatMoney(wonValue, currency)} icon={Briefcase} /> : null}
        {view.deals !== null ? <MetricCard label="Open deals" value={String(openDeals.length)} icon={Briefcase} /> : null}
        {view.currentOnboardingDetail?.progress.kind === "MEASURED" ? <MetricCard label="Onboarding progress" value={`${view.currentOnboardingDetail.progress.percent}%`} icon={Rocket} /> : null}
        {view.billing ? <MetricCard label="Amount due" value={formatMoney(view.billing.recentInvoices.reduce((s, i) => s + i.amountDue, 0), view.billing.billingAccount.currency)} icon={CreditCard} trend={view.health.hasPastDueInvoice ? "down" : "neutral"} /> : null}
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Linked organization" description="The customer-facing tenant this CRM company converted to, if any." />
        {view.linkedOrganization ? (
          <Card className="max-w-2xl">
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Organization</span>
                <Link href={`/admin/organizations/${view.linkedOrganization.id}`} className="font-medium hover:underline">
                  {view.linkedOrganization.displayName}
                </Link>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={view.linkedOrganization.status === "ACTIVE" ? "success" : view.linkedOrganization.status === "SUSPENDED" ? "warning" : "destructive"}>{view.linkedOrganization.status}</StatusBadge>
              </div>
              {view.linkedOrganizationMemberCounts ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Members</span>
                  <span>
                    {view.linkedOrganizationMemberCounts.ACTIVE} active · {view.linkedOrganizationMemberCounts.INVITED} invited
                  </span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <EmptyState title="Not yet a customer" description="This company has not converted to a linked organization — it has no billing account or membership state yet." />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5">
          <HeartPulse className="size-4 text-muted-foreground" aria-hidden="true" />
          <SectionHeader title="Raw health indicators" description="Factual signals only — a real health score/churn model is Roadmap Module 19 (Client Success), not this build." className="flex-1" />
        </div>
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-2 text-sm">
            <IndicatorRow label="Lifecycle stage" value={CUSTOMER_LIFECYCLE_STAGE_LABELS[view.health.lifecycleStage]} />
            <IndicatorRow label="Onboarding status" value={view.health.onboardingStatus ?? "—"} />
            <IndicatorRow label="Organization status" value={view.health.organizationStatus ?? "—"} />
            <IndicatorRow label="Contract status" value={view.health.latestContractStatus ?? "—"} />
            <IndicatorRow label="Billing account status" value={view.health.billingAccountStatus ?? "—"} />
            <IndicatorRow label="Subscription status" value={view.health.subscriptionStatus ?? "—"} />
            <IndicatorRow label="Past-due invoice" value={view.health.hasPastDueInvoice === null ? "—" : view.health.hasPastDueInvoice ? "Yes" : "No"} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function IndicatorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ContactsTab({ view }: { view: Customer360ViewModel }) {
  if (view.contacts.length === 0) return <EmptyState icon={Users} title="No contacts yet" />;
  return (
    <div className="flex flex-col gap-2">
      {view.contacts.map((contact) => (
        <Card key={contact.id}>
          <CardContent className="flex items-center justify-between gap-4">
            <Link href={`/admin/crm/contacts/${contact.id}`} className="flex flex-col hover:underline">
              <span className="text-sm font-medium">
                {contact.firstName} {contact.lastName}
                {view.primaryContact?.id === contact.id ? <span className="ml-2 text-xs text-muted-foreground">(primary)</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">{contact.jobTitle ?? contact.email ?? "—"}</span>
            </Link>
            <StatusBadge status={contact.status === "ACTIVE" ? "success" : "neutral"}>{contact.status}</StatusBadge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ServicesTab({ view }: { view: Customer360ViewModel }) {
  // No hard denial state here, unlike Sales/Onboarding/Billing — this
  // tab has ALWAYS had a fallback (the onboarding/proposal snapshot)
  // available under `crm.read` alone; `delivery_services.read` only
  // controls whether the richer canonical tier is attempted (see
  // `resolveServices()`'s own precedence comment). A caller without it
  // still sees the exact same snapshot view Build 24 originally shipped.
  if (!view.services || view.services.items.length === 0) {
    return <EmptyState icon={Package} title="No sold services on record" description="Services appear once a proposal is accepted, onboarding has started, or a service is provisioned in Service Management." />;
  }
  if (view.services.source === "canonical") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">From Service Management — the canonical operational record.</p>
        <div className="flex flex-col gap-2">
          {view.services.items.map((item) => (
            <Link key={item.id} href={`/admin/services/customers/${item.id}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{item.serviceName}</span>
                    <StatusBadge status={customerServiceStatusVariant(item.status)}>{item.status}</StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{SERVICE_CATEGORY_LABELS[item.category]}</span>
                    {item.ownerName ? <span>Owner: {item.ownerName}</span> : null}
                    {item.targetEndDate ? <span>Target: {fmtDate(item.targetEndDate)}</span> : null}
                    {item.linkedProjectTitles.length > 0 ? <span>{item.linkedProjectTitles.length} linked project(s)</span> : null}
                  </div>
                  {item.category === "SEO" ? <SeoPerformanceSummaryRow canSee={view.canSeeSeoPerformance} performance={item.seoPerformance} /> : null}
                  {item.category === "LOCAL_SEO" ? <LocalSeoPerformanceSummaryRow canSee={view.canSeeLocalSeoPerformance} performance={item.localSeoPerformance} /> : null}
                  {item.category === "WEB_DEVELOPMENT" ? <WebsiteDevPerformanceSummaryRow canSee={view.canSeeWebsiteDevPerformance} performance={item.websiteDevPerformance} /> : null}
                  {item.category === "ECOMMERCE" ? <EcommercePerformanceSummaryRow canSee={view.canSeeEcommercePerformance} performance={item.ecommercePerformance} /> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{view.services.source === "onboarding" ? "From the onboarding service snapshot (operational record)." : "From the accepted proposal's line items (not yet onboarding)."}</p>
      <div className="flex flex-col gap-2">
        {view.services.items.map((item, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{item.title}</span>
                {item.description ? <span className="text-xs text-muted-foreground">{item.description}</span> : null}
              </div>
              <span className="text-sm text-muted-foreground">×{item.quantity}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Build 30 — SEO OS's own aggregated performance signal for this customer's ACTIVE SEO engagement(s), rendered inline on the canonical service card (no separate Customer 360 tab — the "smallest specialist integration seam" the master prompt calls for). `performance === null` is ambiguous between "not authorized" and "no data yet" — `canSee` disambiguates, matching every other `canSeeX` gate on this page. */
function SeoPerformanceSummaryRow({ canSee, performance }: { canSee: boolean; performance: SeoServicePerformanceInput | null }) {
  if (!canSee) return <p className="text-xs text-muted-foreground">SEO performance requires the seo.read permission.</p>;
  if (!performance || performance.observedKeywordCount === 0) return <p className="text-xs text-muted-foreground">No SEO performance data yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
      <span>{performance.observedKeywordCount} keyword(s) tracked</span>
      <span>{performance.improvingKeywordCount} improving</span>
      <span>{performance.decliningKeywordCount} declining</span>
      {performance.openCriticalIssueCount > 0 ? <span className="text-destructive">{performance.openCriticalIssueCount} critical issue(s)</span> : null}
      {performance.openWarningIssueCount > 0 ? <span>{performance.openWarningIssueCount} warning issue(s)</span> : null}
    </div>
  );
}

/** Build 31 — Local SEO's own SEPARATE aggregated performance signal, same rendering/authorization-gate discipline as `SeoPerformanceSummaryRow` immediately above. */
function LocalSeoPerformanceSummaryRow({ canSee, performance }: { canSee: boolean; performance: LocalSeoServicePerformanceInput | null }) {
  if (!canSee) return <p className="text-xs text-muted-foreground">Local SEO performance requires the local_seo.read permission.</p>;
  if (!performance || (performance.observedKeywordCount === 0 && performance.measurableListingCount === 0)) return <p className="text-xs text-muted-foreground">No Local SEO performance data yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
      <span>{performance.observedKeywordCount} local keyword(s) tracked</span>
      <span>{performance.improvingKeywordCount} improving</span>
      <span>{performance.decliningKeywordCount} declining</span>
      {performance.measurableListingCount > 0 ? (
        <span>
          {performance.inconsistentListingCount}/{performance.measurableListingCount} listing(s) inconsistent
        </span>
      ) : null}
      {performance.openCriticalIssueCount > 0 ? <span className="text-destructive">{performance.openCriticalIssueCount} critical issue(s)</span> : null}
      {performance.openWarningIssueCount > 0 ? <span>{performance.openWarningIssueCount} warning issue(s)</span> : null}
    </div>
  );
}

/** Build 32 — Website Development's own SEPARATE aggregated delivery-performance signal (never website traffic/business performance — see docs/architecture/website-development-os.md), same rendering/authorization-gate discipline as `SeoPerformanceSummaryRow`/`LocalSeoPerformanceSummaryRow` above. */
function WebsiteDevPerformanceSummaryRow({ canSee, performance }: { canSee: boolean; performance: WebsiteServicePerformanceInput | null }) {
  if (!canSee) return <p className="text-xs text-muted-foreground">Website Development performance requires the website_development.read permission.</p>;
  if (!performance || performance.activeSiteCount === 0) return <p className="text-xs text-muted-foreground">No Website Development performance data yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
      <span>
        {performance.activeSiteCount} active site{performance.activeSiteCount === 1 ? "" : "s"}
      </span>
      {performance.anyOverdueUnlaunchedSite ? <span className="text-destructive">Launch overdue</span> : null}
      {performance.requiredQaFailedCount > 0 ? <span className="text-destructive">{performance.requiredQaFailedCount} required QA failed</span> : null}
      {performance.requiredQaPendingCount > 0 ? <span>{performance.requiredQaPendingCount} required QA pending</span> : null}
      {performance.anyReadinessNotReady ? <span>Not launch-ready</span> : null}
      {performance.nearestUpcomingLaunchTargetDate ? <span>Next launch target: {fmtDate(performance.nearestUpcomingLaunchTargetDate)}</span> : null}
    </div>
  );
}

/** Build 33 — E-Commerce Development's own SEPARATE aggregated delivery-performance signal (never merchant business performance — revenue/conversion/AOV/ROAS — none of which exist as real data here; see docs/architecture/ecommerce-development-os.md), same rendering/authorization-gate discipline as `SeoPerformanceSummaryRow`/`LocalSeoPerformanceSummaryRow`/`WebsiteDevPerformanceSummaryRow` above. */
function EcommercePerformanceSummaryRow({ canSee, performance }: { canSee: boolean; performance: EcommerceServicePerformanceInput | null }) {
  if (!canSee) return <p className="text-xs text-muted-foreground">E-Commerce Development performance requires the ecommerce_development.read permission.</p>;
  if (!performance || performance.activeStoreCount === 0) return <p className="text-xs text-muted-foreground">No E-Commerce Development performance data yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
      <span>
        {performance.activeStoreCount} active store{performance.activeStoreCount === 1 ? "" : "s"}
      </span>
      {performance.anyOverdueUnlaunchedStore ? <span className="text-destructive">Launch overdue</span> : null}
      {performance.requiredQaFailedCount > 0 ? <span className="text-destructive">{performance.requiredQaFailedCount} required QA failed</span> : null}
      {performance.requiredQaPendingCount > 0 ? <span>{performance.requiredQaPendingCount} required QA pending</span> : null}
      {performance.anyReadinessNotReady ? <span>Not launch-ready</span> : null}
      {performance.nearestUpcomingLaunchTargetDate ? <span>Next launch target: {fmtDate(performance.nearestUpcomingLaunchTargetDate)}</span> : null}
    </div>
  );
}

function SalesTab({ view }: { view: Customer360ViewModel }) {
  if (!view.canSeeSales) return <EmptyState icon={ShieldAlert} title="No access" description="Viewing deals requires the crm.pipeline.read permission." />;
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeader title="Deals" />
        {!view.deals || view.deals.length === 0 ? (
          <EmptyState icon={Briefcase} title="No deals yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {view.deals.map((deal) => (
              <Card key={deal.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <Link href={`/admin/crm/deals/${deal.id}`} className="text-sm font-medium hover:underline">
                    {deal.title}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{formatMoney(deal.valueMinorUnits, deal.currency)}</span>
                    <StatusBadge status={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "info"}>{deal.status}</StatusBadge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {view.proposals !== null ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Proposals" />
          {view.proposals.length === 0 ? (
            <EmptyState icon={FileText} title="No proposals yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {view.proposals.map((p) => (
                <Card key={p.id}>
                  <CardContent className="flex items-center justify-between gap-4">
                    <Link href={`/admin/crm/proposals/${p.id}`} className="text-sm font-medium hover:underline">
                      {p.proposalNumber}
                    </Link>
                    <StatusBadge status={proposalStatusVariant(p.status)}>{p.status}</StatusBadge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view.contracts !== null ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Contracts" />
          {view.contracts.length === 0 ? (
            <EmptyState icon={FileText} title="No contracts yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {view.contracts.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex items-center justify-between gap-4">
                    <Link href={`/admin/crm/contracts/${c.id}`} className="text-sm font-medium hover:underline">
                      {c.contractNumber}
                    </Link>
                    <StatusBadge status={contractStatusVariant(c.status)}>{c.status}</StatusBadge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function OnboardingTab({ view }: { view: Customer360ViewModel }) {
  if (!view.canSeeOnboarding) return <EmptyState icon={ShieldAlert} title="No access" description="Viewing onboarding requires the crm.onboarding.read permission." />;
  if (!view.onboardings || view.onboardings.length === 0) return <EmptyState icon={Rocket} title="No onboarding engagement yet" description="Onboarding starts once a deal is won and converted." />;
  return (
    <div className="flex flex-col gap-2">
      {view.onboardings.map((o) => (
        <Card key={o.id}>
          <CardContent className="flex items-center justify-between gap-4">
            <Link href={`/admin/crm/onboarding/${o.id}`} className="text-sm font-medium hover:underline">
              Onboarding started {fmtDate(o.createdAt)}
            </Link>
            <StatusBadge status={onboardingStatusVariant(o.status)}>{o.status.replace("_", " ")}</StatusBadge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BillingTab({ view }: { view: Customer360ViewModel }) {
  if (!view.canSeeBilling) return <EmptyState icon={ShieldAlert} title="No access" description="Viewing billing requires the billing.readPlatform permission." />;
  if (!view.linkedOrganization) return <EmptyState icon={CreditCard} title="Not yet a customer" description="Billing starts once this company converts to a linked organization." />;
  if (!view.billing) return <EmptyState icon={CreditCard} title="No billing account" description="This organization has not started billing yet." />;

  const { billing } = view;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Account status" value={billing.billingAccount.status} icon={CreditCard} />
        <MetricCard label="Subscription" value={billing.subscription?.status ?? "None"} icon={CreditCard} />
        <MetricCard label="Credit balance" value={formatMoney(billing.creditBalance, billing.billingAccount.currency)} icon={CreditCard} />
      </div>
      <section className="flex flex-col gap-4">
        <SectionHeader title="Recent invoices" />
        {billing.recentInvoices.length === 0 ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {billing.recentInvoices.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <Link href={`/admin/billing/organizations/${view.linkedOrganization!.id}`} className="text-sm font-medium hover:underline">
                    {inv.invoiceNumber}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{formatMoney(inv.total, inv.currency)}</span>
                    <StatusBadge status={inv.status === "PAID" ? "success" : inv.status === "VOID" || inv.status === "UNCOLLECTIBLE" ? "destructive" : "warning"}>{inv.status}</StatusBadge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Link href={`/admin/billing/organizations/${view.linkedOrganization.id}`} className="text-sm text-link hover:underline w-fit">
          View full billing detail →
        </Link>
      </section>
    </div>
  );
}

function ActivityTab({ view }: { view: Customer360ViewModel }) {
  if (view.activity.length === 0) return <EmptyState icon={ActivityIcon} title="No activity yet" />;
  return <CustomerActivityTab entries={view.activity} />;
}

function DocumentsTab({ view }: { view: Customer360ViewModel }) {
  if (view.documents.length === 0) return <EmptyState icon={FileText} title="No documents on record" description="Accepted proposals, contracts, and onboarding document references appear here as their own real types — never a generic file record." />;
  return (
    <div className="flex flex-col gap-2">
      {view.documents.map((d) => (
        <Card key={`${d.kind}:${d.id}`}>
          <CardContent className="flex items-center justify-between gap-4">
            <Link href={d.href} className="flex flex-col hover:underline">
              <span className="text-sm font-medium">{d.title}</span>
              <span className="text-xs text-muted-foreground capitalize">{d.kind.replace("_", " ")} · {fmtDate(d.timestamp)}</span>
            </Link>
            <StatusBadge status="neutral">{d.status}</StatusBadge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FutureDomainsTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <EmptyState icon={LifeBuoy} title="Support tickets" description="Not available yet — Roadmap Module 30 (Support Center) will own this." />
      <EmptyState icon={MessageSquare} title="Conversations" description="Not available yet — Roadmap Module 46 (Communication Center) will own this." />
    </div>
  );
}

/** Build 27 — Project Management. Composed entirely from `listProjectsForCustomer360()`'s own safe summary shape; the full operational detail (milestones/tasks/comments/QA/approvals) lives at `/admin/projects/[id]`, which every row links to. */
function ProjectsTab({ projects, hasLinkedOrganization }: { projects: Customer360ProjectSummary[]; hasLinkedOrganization: boolean }) {
  if (!hasLinkedOrganization) {
    return <EmptyState icon={FolderKanban} title="No linked organization yet" description="This company has not converted to a customer organization — there is nothing to create a project for yet." />;
  }
  if (projects.length === 0) {
    return <EmptyState icon={FolderKanban} title="No projects yet" description="No delivery projects have been created for this customer." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {projects.map((project) => (
        <Card key={project.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <Link href={`/admin/projects/${project.id}`} className="text-sm font-medium hover:underline">
                {project.title}
              </Link>
              <div className="flex items-center gap-2">
                <StatusBadge status={projectPriorityVariant(project.priority)}>{project.priority}</StatusBadge>
                <StatusBadge status={projectStatusVariant(project.status)}>{project.status}</StatusBadge>
              </div>
            </div>
            <ProjectProgressDisplay progress={project.progress} />
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Start: {fmtDate(project.startDate)}</span>
              <span>Target: {fmtDate(project.targetEndDate)}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
