import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getProposalDetail } from "@/server/services/crm-proposal-service";
import { toAppError } from "@/lib/errors/app-error";
import { ProposalDraftEditor } from "@/components/crm/proposals/proposal-draft-editor";

export const metadata: Metadata = { title: "Revise Proposal" };

/** Starts a NEW version pre-filled from the current one — only valid once the current version has left DRAFT (SENT/REJECTED/EXPIRED); never reachable for an ACCEPTED proposal, whose terms are permanent. */
export default async function ReviseProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.proposal.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Revise Proposal" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.proposal.manage permission." />
      </div>
    );
  }

  let detail;
  try {
    detail = await getProposalDetail({ proposalId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
  const { proposal, currentVersion } = detail;

  if (!currentVersion || currentVersion.status === "DRAFT" || proposal.status === "ACCEPTED") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Revise Proposal" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: proposal.proposalNumber, href: `/admin/crm/proposals/${proposal.id}` }, { label: "Revise" }]} />
        <EmptyState title="This proposal cannot be revised right now" description={proposal.status === "ACCEPTED" ? "An accepted proposal's terms are permanent." : "Its current version is still an editable draft — use “Edit draft” instead."} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Revise Proposal"
        description={`${proposal.proposalNumber} — this creates version ${currentVersion.versionNumber + 1}, pre-filled from the current one.`}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: proposal.proposalNumber, href: `/admin/crm/proposals/${proposal.id}` }, { label: "Revise" }]}
      />
      <Card>
        <CardContent>
          <ProposalDraftEditor proposalId={proposal.id} version={currentVersion} lineItems={currentVersion.lineItems} mode="revise" />
        </CardContent>
      </Card>
    </div>
  );
}
