import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Users2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listOnboardings } from "@/server/services/crm-client-onboarding-service";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { onboardingStatusVariant } from "@/components/crm/onboarding/onboarding-status";
import type { CrmClientOnboardingStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Client Onboarding" };

/** Every onboarding engagement across all deals (Build 23 — Roadmap Module 17) — `crm.onboarding.read`. Bounded to 200, same realistic-total assumption every prior CRM list page documents. */
export default async function CrmOnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.onboarding.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Client Onboarding" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Onboarding" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.onboarding.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as CrmClientOnboardingStatus | undefined;
  const onboardings = await listOnboardings({ status });
  const canManage = context.permissions.has("crm.onboarding.manage");
  const statuses: CrmClientOnboardingStatus[] = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Client Onboarding"
        description="Operational engagements converting a sold deal into an active client — Deal → Onboarding → Complete."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Onboarding" }]}
        actions={
          canManage ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/crm/onboarding/intake-fields">Intake fields</Link>
            </Button>
          ) : null
        }
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/crm/onboarding" className={`rounded-md border px-3 py-1.5 text-sm ${!status ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
            All
          </Link>
          {statuses.map((s) => (
            <Link key={s} href={`/admin/crm/onboarding?status=${s}`} className={`rounded-md border px-3 py-1.5 text-sm ${status === s ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
              {s.replace("_", " ")}
            </Link>
          ))}
        </div>

        {onboardings.length === 0 ? (
          <EmptyState icon={Users2} title="No onboarding engagements match these filters" description="Start onboarding from an eligible, WON deal's own detail page." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Client onboarding table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Deal</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Kickoff owner</th>
                  <th className="px-4 py-2.5">Started</th>
                </tr>
              </thead>
              <tbody>
                {onboardings.map((onboarding) => (
                  <tr key={onboarding.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/onboarding/${onboarding.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{onboarding.linkedOrganization.displayName}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/deals/${onboarding.deal.id}`} className="hover:underline">
                        {onboarding.deal.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={onboardingStatusVariant(onboarding.status)}>{onboarding.status.replace("_", " ")}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{onboarding.kickoffOwnerUser?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatInTimeZone(onboarding.createdAt, "UTC")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
