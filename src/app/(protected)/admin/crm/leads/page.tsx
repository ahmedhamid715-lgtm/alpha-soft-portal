import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Target } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listLeads } from "@/server/services/crm-lead-service";
import { listCompanies } from "@/server/services/crm-company-service";
import { listLeadSources } from "@/server/services/crm-lead-source-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { CrmPaginationControls } from "@/components/crm/pagination-controls";
import { NewLeadForm } from "./new-lead-form";
import type { CrmLeadStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "CRM Leads" };

function leadStatusVariant(status: CrmLeadStatus): "neutral" | "info" | "warning" | "success" | "destructive" | "primary" {
  switch (status) {
    case "NEW":
      return "info";
    case "CONTACTED":
      return "warning";
    case "QUALIFIED":
      return "primary";
    case "CONVERTED":
      return "success";
    case "DISQUALIFIED":
      return "destructive";
    default:
      return "neutral";
  }
}

export default async function CrmLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Leads" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Leads" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const page = Number(single(sp.page) ?? "1") || 1;
  const search = single(sp.search);
  const status = single(sp.status) as CrmLeadStatus | undefined;

  const canManage = context.permissions.has("crm.manage");
  const [result, companies, sources, users] = await Promise.all([
    listLeads({ page, limit: 25, search, status }),
    canManage ? listCompanies({ limit: 100, status: "ACTIVE" }) : null,
    canManage ? listLeadSources() : null,
    canManage ? listAssignableUsers() : null,
  ]);

  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (status) filterParams.set("status", status);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Leads" description="Alpha Page Rankers' own sales leads, from first contact through conversion or disqualification." breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Leads" }]} />

      {canManage && companies && sources && users ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="New lead" />
          <Card className="max-w-3xl">
            <CardContent>
              <NewLeadForm companies={companies.items} sources={sources} users={users} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="lead-search" className="text-xs text-muted-foreground">
              Search
            </label>
            <input id="lead-search" type="search" name="search" defaultValue={search ?? ""} placeholder="Lead title…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="lead-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select id="lead-status" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">Any status</option>
              {(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DISQUALIFIED"] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
            Filter
          </button>
          {search || status ? (
            <Link href="/admin/crm/leads" className="px-3 py-1.5 text-sm text-muted-foreground hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={Target} title="No leads match these filters" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Leads table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Lead</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((lead) => (
                  <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/leads/${lead.id}`} className="font-medium hover:underline">
                        {lead.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={leadStatusVariant(lead.status)}>{lead.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <CrmPaginationControls basePath="/admin/crm/leads" filterParams={filterParams} pageInfo={result.pageInfo} />
      </section>
    </div>
  );
}
