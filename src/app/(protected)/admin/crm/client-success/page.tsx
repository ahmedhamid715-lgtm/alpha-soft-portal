import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, CreditCard, RefreshCw, TrendingUp, Rocket } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getClientSuccessPortfolio } from "@/server/services/crm-client-success-portfolio-service";
import { FINANCIAL_HEALTH_LABELS, FINANCIAL_HEALTH_TONE } from "@/lib/billing/reporting/financial-health";
import { onboardingStatusVariant } from "@/components/crm/onboarding/onboarding-status";

export const metadata: Metadata = { title: "Client Success" };

function fmtDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * The Client Success portfolio (Build 25) — a lean, bulk-queried
 * aggregation (`getClientSuccessPortfolio()`), NOT `getCustomer360()`
 * looped over every customer. See client-success.md "Performance."
 */
export default async function ClientSuccessPortfolioPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.client_success.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Client Success" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing the Client Success portfolio requires the crm.client_success.read permission." />
      </div>
    );
  }

  const portfolio = await getClientSuccessPortfolio();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Client Success" description="Customers needing attention — renewals, expansion opportunities, and blocked onboarding, from real bulk data." breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Client Success" }]} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Payment at risk" value={portfolio.paymentAtRisk.canSee ? String(portfolio.paymentAtRisk.organizations.length) : "—"} icon={CreditCard} trend={portfolio.paymentAtRisk.organizations.length > 0 ? "down" : "neutral"} />
        <MetricCard label="Contracts expiring, no renewal" value={String(portfolio.contractsExpiringWithoutRenewal.length)} icon={RefreshCw} trend={portfolio.contractsExpiringWithoutRenewal.length > 0 ? "down" : "neutral"} />
        <MetricCard label="Open expansion opportunities" value={String(portfolio.openExpansions.length)} icon={TrendingUp} />
        <MetricCard label="Blocked onboardings" value={String(portfolio.blockedOnboardings.length)} icon={Rocket} trend={portfolio.blockedOnboardings.length > 0 ? "down" : "neutral"} />
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Payment at risk" description="From the platform's own financial-health classification (Build 14) — AT_RISK or CRITICAL." />
        {!portfolio.paymentAtRisk.canSee ? (
          <EmptyState icon={ShieldAlert} title="No access" description="Requires the billing.analytics.read permission." />
        ) : portfolio.paymentAtRisk.organizations.length === 0 ? (
          <EmptyState icon={CreditCard} title="No customers currently at payment risk" />
        ) : (
          <div className="flex flex-col gap-2">
            {portfolio.paymentAtRisk.organizations.map((o) => (
              <Card key={o.organizationId}>
                <CardContent className="flex items-center justify-between gap-3">
                  {o.companyId ? (
                    <Link href={`/admin/crm/customers/${o.companyId}`} className="text-sm font-medium hover:underline">
                      {o.companyName ?? o.organizationName}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{o.organizationName}</span>
                  )}
                  <StatusBadge status={FINANCIAL_HEALTH_TONE[o.health.classification]}>{FINANCIAL_HEALTH_LABELS[o.health.classification]}</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Contracts expiring without an open renewal" description="Active contracts expiring within 30 days that nobody has started tracking a renewal for yet." />
        {portfolio.contractsExpiringWithoutRenewal.length === 0 ? (
          <EmptyState icon={RefreshCw} title="Nothing expiring without a tracked renewal" />
        ) : (
          <div className="flex flex-col gap-2">
            {portfolio.contractsExpiringWithoutRenewal.map(({ contract, company }) => (
              <Card key={contract.id}>
                <CardContent className="flex items-center justify-between gap-3">
                  <Link href={`/admin/crm/customers/${company.id}`} className="text-sm font-medium hover:underline">
                    {company.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {contract.contractNumber} — expires {fmtDate(contract.endDate)}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Open renewals" />
        {portfolio.openRenewals.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No open renewals" />
        ) : (
          <div className="flex flex-col gap-2">
            {portfolio.openRenewals.map((r) => (
              <Card key={r.id}>
                <CardContent className="flex items-center justify-between gap-3">
                  <Link href={`/admin/crm/customers/${r.company.id}`} className="text-sm font-medium hover:underline">
                    {r.company.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {r.contract.contractNumber} — target {fmtDate(r.renewalDate)} · {r.ownerUser?.name ?? "Unassigned"}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Open expansion opportunities" />
        {portfolio.openExpansions.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No open expansion opportunities" />
        ) : (
          <div className="flex flex-col gap-2">
            {portfolio.openExpansions.map((e) => (
              <Card key={e.id}>
                <CardContent className="flex items-center justify-between gap-3">
                  <Link href={`/admin/crm/customers/${e.company.id}`} className="text-sm font-medium hover:underline">
                    {e.company.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">{e.title}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Blocked onboardings" />
        {portfolio.blockedOnboardings.length === 0 ? (
          <EmptyState icon={Rocket} title="No blocked onboarding engagements" />
        ) : (
          <div className="flex flex-col gap-2">
            {portfolio.blockedOnboardings.map((o) => (
              <Card key={o.id}>
                <CardContent className="flex items-center justify-between gap-3">
                  <Link href={`/admin/crm/onboarding/${o.id}`} className="text-sm font-medium hover:underline">
                    {o.company.name}
                  </Link>
                  <StatusBadge status={onboardingStatusVariant(o.status)}>{o.status}</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
