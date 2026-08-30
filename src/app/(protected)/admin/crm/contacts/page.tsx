import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listContacts } from "@/server/services/crm-contact-service";
import { CrmPaginationControls } from "@/components/crm/pagination-controls";
import type { CrmContactStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "CRM Contacts" };

export default async function CrmContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Contacts" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contacts" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const page = Number(single(sp.page) ?? "1") || 1;
  const search = single(sp.search);
  const status = single(sp.status) as CrmContactStatus | undefined;

  const result = await listContacts({ page, limit: 25, search, status });

  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (status) filterParams.set("status", status);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Contacts"
        description="People at companies in Alpha Page Rankers' own sales pipeline. Add a contact from its company's own page."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contacts" }]}
      />

      <section className="flex flex-col gap-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="contact-search" className="text-xs text-muted-foreground">
              Search
            </label>
            <input id="contact-search" type="search" name="search" defaultValue={search ?? ""} placeholder="Name or email…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="contact-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select id="contact-status" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
            Filter
          </button>
          {search || status ? (
            <Link href="/admin/crm/contacts" className="px-3 py-1.5 text-sm text-muted-foreground hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={Users} title="No contacts match these filters" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Contacts table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Job title</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((contact) => (
                  <tr key={contact.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/contacts/${contact.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">
                          {contact.firstName} {contact.lastName}
                        </span>
                        {contact.email ? <span className="text-xs text-muted-foreground">{contact.email}</span> : null}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{contact.jobTitle ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={contact.status === "ACTIVE" ? "success" : "neutral"}>{contact.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <CrmPaginationControls basePath="/admin/crm/contacts" filterParams={filterParams} pageInfo={result.pageInfo} />
      </section>
    </div>
  );
}
