import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getProposalWithRelations } from "@/server/services/crm-proposal-service";
import { getDeal } from "@/server/services/crm-deal-service";
import { toAppError } from "@/lib/errors/app-error";
import { NewContractForm } from "@/components/crm/contracts/new-contract-form";

export const metadata: Metadata = { title: "New Contract" };

/**
 * Two entry points, both requiring an explicit query param — no
 * standalone "pick anything" contract creation, since a contract always
 * needs a real originating deal (and usually an accepted proposal):
 *   - `?proposalId=` — the common path, from an ACCEPTED proposal.
 *   - `?dealId=` — a manually recorded agreement reached outside a
 *     Build 22 proposal (see `createManualContract()`'s own comment).
 */
export default async function NewContractPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const proposalId = single(sp.proposalId);
  const dealId = single(sp.dealId);
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.contract.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New Contract" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.contract.manage permission." />
      </div>
    );
  }

  if (!proposalId && !dealId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New Contract" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contracts", href: "/admin/crm/contracts" }, { label: "New" }]} />
        <EmptyState title="Start from a proposal or a deal" description="Create a contract from an accepted proposal's own page, or from a deal's own detail page for a manually recorded agreement." action={<Link href="/admin/crm/proposals" className="text-sm text-primary hover:underline">Go to Proposals</Link>} />
      </div>
    );
  }

  if (proposalId) {
    // `getProposalWithRelations()`, not `getProposalDetail()` — this page
    // only ever renders `proposalNumber`/`company.name`/`status`, never
    // the current version's own commercial content or line items.
    // Flagged by the Build 22 performance review: the prior version paid
    // for the version + line-item queries (up to ~400KB of bodyHtml/
    // termsHtml) on every load of this page for no rendered benefit.
    let proposal;
    try {
      proposal = await getProposalWithRelations({ proposalId });
    } catch (error) {
      if (toAppError(error).code === "NOT_FOUND") notFound();
      throw error;
    }
    if (proposal.status !== "ACCEPTED") {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="New Contract" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contracts", href: "/admin/crm/contracts" }, { label: "New" }]} />
          <EmptyState title="This proposal is not accepted" description="A contract can only be created from an ACCEPTED proposal." />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="New Contract" description={`From ${proposal.proposalNumber} — ${proposal.company.name}.`} breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contracts", href: "/admin/crm/contracts" }, { label: "New" }]} />
        <Card>
          <CardContent>
            <NewContractForm source={{ type: "proposal", proposalId }} />
          </CardContent>
        </Card>
      </div>
    );
  }

  let deal;
  try {
    deal = await getDeal({ dealId: dealId! });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="New Contract (Manual)" description={`For ${deal.title} — recorded outside a Build 22 proposal.`} breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contracts", href: "/admin/crm/contracts" }, { label: "New" }]} />
      <Card>
        <CardContent>
          <NewContractForm source={{ type: "manual", dealId: deal.id }} />
        </CardContent>
      </Card>
    </div>
  );
}
