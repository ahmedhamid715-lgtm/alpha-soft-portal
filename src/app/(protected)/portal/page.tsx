import type { Metadata } from "next";
import Link from "next/link";
import { Building2, RefreshCw, CreditCard, FileText, Bell, Rocket } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { PortalOrganizationPicker } from "@/components/portal/portal-organization-picker";
import { getPortalDashboard } from "@/server/services/portal/portal-dashboard-service";
import { resolvePortalContext } from "@/lib/portal/context";
import { formatMoney } from "@/lib/utils/money";
import { NotificationItem } from "@/components/notifications/notification-item";

export const metadata: Metadata = { title: "Portal" };

const ONBOARDING_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral" | "info"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  BLOCKED: "destructive",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

/**
 * The Customer Portal home (Build 26 — Roadmap Module 20). Real
 * customer-visible facts only — company status, onboarding progress,
 * services purchased, outstanding billing, recent notifications. Never
 * churn risk / health score / sales pipeline / internal forecasts (see
 * customer-portal.md "Internal/customer data boundary" — those stay
 * exclusively on the internal Client Success surface).
 */
export default async function PortalDashboardPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Portal" />;

  const [dashboard, portalContext] = await Promise.all([getPortalDashboard({ organizationId: guard.organizationId }), resolvePortalContext()]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`Welcome, ${dashboard.organization.displayName}`} description="Your account, services, and billing with Alpha Page Rankers." />

      {portalContext.eligibleOrganizations.length > 1 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Switch organization" description="You belong to more than one organization." />
          <PortalOrganizationPicker organizations={portalContext.eligibleOrganizations} />
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Account status" value={dashboard.organization.crmLinked ? "Active client" : "Not yet linked"} icon={Building2} />
        <MetricCard label="Onboarding" value={dashboard.onboarding ? ONBOARDING_STATUS_LABEL[dashboard.onboarding.status] ?? dashboard.onboarding.status : "Not started"} icon={Rocket} />
        <MetricCard label="Services" value={String(dashboard.servicesCount)} icon={RefreshCw} />
        <MetricCard label="Latest invoice" value={dashboard.billing.canSee ? (dashboard.billing.latestInvoice ? formatMoney(dashboard.billing.latestInvoice.total, dashboard.billing.latestInvoice.currency) : "None yet") : "—"} icon={CreditCard} />
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Onboarding progress" />
        {!dashboard.onboarding ? (
          <EmptyState icon={Rocket} title="No onboarding engagement yet" description="This will appear once your onboarding with Alpha Page Rankers begins." />
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <StatusBadge status={ONBOARDING_STATUS_TONE[dashboard.onboarding.status] ?? "neutral"}>{dashboard.onboarding.status.replace(/_/g, " ")}</StatusBadge>
                {dashboard.onboarding.progressPercent !== null ? <span className="text-sm text-muted-foreground">{dashboard.onboarding.progressPercent}% complete</span> : null}
              </div>
              {dashboard.onboarding.kickoffScheduledAt ? <p className="text-sm text-muted-foreground">Kickoff scheduled: {new Date(dashboard.onboarding.kickoffScheduledAt).toLocaleDateString()}</p> : null}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Billing" />
        {!dashboard.billing.canSee ? (
          <EmptyState icon={CreditCard} title="No access" description="Viewing billing requires the billing.read permission for this organization." />
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Account status</span>
                <StatusBadge status={dashboard.billing.accountStatus === "ACTIVE" ? "success" : "neutral"}>{dashboard.billing.accountStatus ?? "No billing account yet"}</StatusBadge>
              </div>
              {dashboard.billing.subscription?.planName ? <p className="text-sm text-muted-foreground">Plan: {dashboard.billing.subscription.planName}</p> : null}
              {dashboard.billing.latestInvoice ? (
                <p className="text-sm text-muted-foreground">
                  Latest invoice {dashboard.billing.latestInvoice.invoiceNumber}: {formatMoney(dashboard.billing.latestInvoice.total, dashboard.billing.latestInvoice.currency)} — {dashboard.billing.latestInvoice.status}
                </p>
              ) : null}
              <Link href="/portal/billing" className="text-sm text-link hover:underline w-fit">
                View billing →
              </Link>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5">
          <Bell className="size-4 text-muted-foreground" aria-hidden="true" />
          <SectionHeader title="Recent notifications" className="flex-1" />
        </div>
        {dashboard.recentNotifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {dashboard.recentNotifications.map((n) => (
              <NotificationItem key={n.id} notification={n} />
            ))}
          </div>
        )}
        <Link href="/portal/notifications" className="text-sm text-link hover:underline w-fit">
          View all →
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Documents" />
        {!dashboard.documentsAvailable ? (
          <EmptyState icon={FileText} title="No documents yet" />
        ) : (
          <Link href="/portal/documents" className="text-sm text-link hover:underline w-fit">
            View your proposal, contract, and onboarding documents →
          </Link>
        )}
      </section>
    </div>
  );
}

const ONBOARDING_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
