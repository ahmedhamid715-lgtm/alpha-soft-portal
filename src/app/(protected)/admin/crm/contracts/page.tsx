import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, FileSignature } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listContracts } from "@/server/services/crm-contract-service";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { contractStatusVariant } from "@/components/crm/proposals/proposal-status";
import type { CrmContractStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Contracts" };

/** Every contract across all deals — `crm.contract.read`. Bounded to 200, same assumption every Build 22 list page documents. */
export default async function CrmContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.contract.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Contracts" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.contract.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as CrmContractStatus | undefined;
  const contracts = await listContracts({ status });
  const statuses: CrmContractStatus[] = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED", "CANCELLED"];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Contracts" description="Commercial agreements — either originated from an accepted proposal, or manually recorded." breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contracts" }]} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/crm/contracts" className={`rounded-md border px-3 py-1.5 text-sm ${!status ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
            All
          </Link>
          {statuses.map((s) => (
            <Link key={s} href={`/admin/crm/contracts?status=${s}`} className={`rounded-md border px-3 py-1.5 text-sm ${status === s ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
              {s}
            </Link>
          ))}
        </div>

        {contracts.length === 0 ? (
          <EmptyState icon={FileSignature} title="No contracts match these filters" description="A contract is created from an accepted proposal's own page, or manually from a deal." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Contracts table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Contract</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Effective</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => (
                  <tr key={contract.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/contracts/${contract.id}`} className="font-medium hover:underline">
                        {contract.contractNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/crm/companies/${contract.company.id}`} className="hover:underline">
                        {contract.company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={contractStatusVariant(contract.status)}>{contract.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{contract.effectiveDate ? formatInTimeZone(contract.effectiveDate, "UTC") : "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatInTimeZone(contract.createdAt, "UTC")}</td>
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
