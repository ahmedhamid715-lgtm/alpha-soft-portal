import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getContractWithRelations } from "@/server/services/crm-contract-service";
import { toAppError } from "@/lib/errors/app-error";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { contractStatusVariant } from "@/components/crm/proposals/proposal-status";
import { ContractLifecycleControls } from "@/components/crm/contracts/contract-lifecycle-controls";

export const metadata: Metadata = { title: "Contract" };

/** A single contract's detail view — `crm.contract.read` to view, `crm.contract.manage` for lifecycle actions. */
export default async function CrmContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.contract.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Contract" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.contract.read permission." />
      </div>
    );
  }

  let contract;
  try {
    contract = await getContractWithRelations({ contractId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const canManage = context.permissions.has("crm.contract.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={contract.contractNumber}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contracts", href: "/admin/crm/contracts" }, { label: contract.contractNumber }]}
        actions={<StatusBadge status={contractStatusVariant(contract.status)}>{contract.status}</StatusBadge>}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Deal</span>
              <Link href={`/admin/crm/deals/${contract.dealId}`} className="hover:underline">
                View deal
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Company</span>
              <Link href={`/admin/crm/companies/${contract.company.id}`} className="hover:underline">
                {contract.company.name}
              </Link>
            </div>
            {contract.originatingProposalId ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Originating proposal</span>
                <Link href={`/admin/crm/proposals/${contract.originatingProposalId}`} className="hover:underline">
                  View proposal
                </Link>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Origin</span>
                <span>Manually recorded</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-2">
              <span className="text-muted-foreground">Effective</span>
              <span>{contract.effectiveDate ? formatInTimeZone(contract.effectiveDate, "UTC") : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">End date</span>
              <span>{contract.endDate ? formatInTimeZone(contract.endDate, "UTC") : "—"}</span>
            </div>
            {contract.renewalTerms ? (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-muted-foreground">Renewal terms</span>
                <p className="text-foreground">{contract.renewalTerms}</p>
              </div>
            ) : null}
            {contract.status === "TERMINATED" && contract.terminatedReason ? (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-muted-foreground">Termination reason</span>
                <p className="text-foreground">{contract.terminatedReason}</p>
              </div>
            ) : null}
            <div className="flex items-center justify-between pt-2">
              <span className="text-muted-foreground">Created by</span>
              <span>{contract.createdByUser.name}</span>
            </div>
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <span className="text-sm text-muted-foreground">Lifecycle</span>
              <ContractLifecycleControls contract={contract} />
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
