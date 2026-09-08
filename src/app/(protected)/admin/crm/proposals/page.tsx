import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listProposals } from "@/server/services/crm-proposal-service";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { proposalStatusVariant } from "@/components/crm/proposals/proposal-status";
import type { CrmProposalStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Proposals" };

/** Every proposal across all deals (Build 22 — Roadmap Module 16) — `crm.proposal.read`. Bounded to 200, same realistic-total assumption `crmProposalRepository.listForOrganization()`'s own comment documents; no pagination UI yet (see docs/architecture/proposals-contracts.md "Known limitations"). */
export default async function CrmProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.proposal.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Proposals" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.proposal.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as CrmProposalStatus | undefined;

  const proposals = await listProposals({ status });
  const canManage = context.permissions.has("crm.proposal.manage");
  const statuses: CrmProposalStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Proposals"
        description="Quotes and proposals sent to prospective and existing customers — always tied back to a Sales Pipeline deal."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals" }]}
        actions={
          canManage ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/crm/proposals/templates">Templates</Link>
            </Button>
          ) : null
        }
      />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/crm/proposals" className={`rounded-md border px-3 py-1.5 text-sm ${!status ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
            All
          </Link>
          {statuses.map((s) => (
            <Link key={s} href={`/admin/crm/proposals?status=${s}`} className={`rounded-md border px-3 py-1.5 text-sm ${status === s ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
              {s}
            </Link>
          ))}
        </div>

        {proposals.length === 0 ? (
          <EmptyState icon={FileText} title="No proposals match these filters" description="Create a proposal from an open deal's own detail page." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Proposals table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Proposal</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Assigned to</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((proposal) => (
                  <tr key={proposal.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/proposals/${proposal.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{proposal.proposalNumber}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/companies/${proposal.company.id}`} className="hover:underline">
                        {proposal.company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={proposalStatusVariant(proposal.status)}>{proposal.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{proposal.assignedToUser?.name ?? "Unassigned"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatInTimeZone(proposal.createdAt, "UTC")}</td>
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
