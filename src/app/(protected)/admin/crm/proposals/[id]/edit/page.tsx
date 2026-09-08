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

export const metadata: Metadata = { title: "Edit Proposal Draft" };

/** Edits the CURRENT version's content — only reachable/valid while it's still DRAFT (the server action re-checks this regardless of what this page renders). */
export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.proposal.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit Proposal" />
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

  if (!currentVersion || currentVersion.status !== "DRAFT") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit Proposal" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: proposal.proposalNumber, href: `/admin/crm/proposals/${proposal.id}` }, { label: "Edit" }]} />
        <EmptyState title="This proposal is no longer editable" description="Its current version has already been sent. Use “Revise” instead to start a new version." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Edit Proposal Draft" description={proposal.proposalNumber} breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: proposal.proposalNumber, href: `/admin/crm/proposals/${proposal.id}` }, { label: "Edit" }]} />
      <Card>
        <CardContent>
          <ProposalDraftEditor proposalId={proposal.id} version={currentVersion} lineItems={currentVersion.lineItems} mode="edit" />
        </CardContent>
      </Card>
    </div>
  );
}
