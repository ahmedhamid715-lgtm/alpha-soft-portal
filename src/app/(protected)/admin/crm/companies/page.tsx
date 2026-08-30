import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listCompanies } from "@/server/services/crm-company-service";
import { CrmPaginationControls } from "@/components/crm/pagination-controls";
import { NewCompanyForm } from "./new-company-form";
import type { CrmCompanyStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "CRM Companies" };

export default async function CrmCompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Companies" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Companies" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const page = Number(single(sp.page) ?? "1") || 1;
  const search = single(sp.search);
  const status = single(sp.status) as CrmCompanyStatus | undefined;

  const result = await listCompanies({ page, limit: 25, search, status });

  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (status) filterParams.set("status", status);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Companies" description="Prospect and customer companies in Alpha Page Rankers' own sales pipeline." breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Companies" }]} />

      {context.permissions.has("crm.manage") ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="New company" />
          <Card className="max-w-2xl">
            <CardContent>
              <NewCompanyForm />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="company-search" className="text-xs text-muted-foreground">
              Search
            </label>
            <input id="company-search" type="search" name="search" defaultValue={search ?? ""} placeholder="Company name…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="company-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select id="company-status" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
            Filter
          </button>
          {search || status ? (
            <Link href="/admin/crm/companies" className="px-3 py-1.5 text-sm text-muted-foreground hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={Building2} title="No companies match these filters" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Companies table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Industry</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((company) => (
                  <tr key={company.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/companies/${company.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{company.name}</span>
                        {company.domain ? <span className="text-xs text-muted-foreground">{company.domain}</span> : null}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{company.industry ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={company.status === "ACTIVE" ? "success" : "neutral"}>{company.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <CrmPaginationControls basePath="/admin/crm/companies" filterParams={filterParams} pageInfo={result.pageInfo} />
      </section>
    </div>
  );
}
