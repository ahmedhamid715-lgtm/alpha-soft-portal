import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getProposalDetail, listProposalVersions } from "@/server/services/crm-proposal-service";
import { listContactsForCompany } from "@/server/services/crm-contact-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { listContracts } from "@/server/services/crm-contract-service";
import { toAppError } from "@/lib/errors/app-error";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { proposalStatusVariant, approvalStatusVariant, contractStatusVariant } from "@/components/crm/proposals/proposal-status";
import { SanitizedHtmlView } from "@/components/crm/proposals/sanitized-html-view";
import { ProposalLifecycleControls } from "@/components/crm/proposals/proposal-lifecycle-controls";
import { ProposalApprovalControls } from "@/components/crm/proposals/proposal-approval-controls";
import { ProposalAcceptForm } from "@/components/crm/proposals/proposal-accept-form";
import { ProposalAssigneeControl } from "@/components/crm/proposals/proposal-assignee-control";
import { ProposalVersionHistory } from "@/components/crm/proposals/proposal-version-history";

export const metadata: Metadata = { title: "Proposal" };

/** A single proposal's detail view — `crm.proposal.read` to view; lifecycle actions individually gated by `crm.proposal.manage`/`crm.proposal.approve` within their own components. */
export default async function CrmProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.proposal.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Proposal" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.proposal.read permission." />
      </div>
    );
  }

  const canManage = context.permissions.has("crm.proposal.manage");
  const canApprove = context.permissions.has("crm.proposal.approve");
  const canCreateContract = context.permissions.has("crm.contract.manage");

  // Stage 1 — everything that needs only the route `id` (not the
  // resolved proposal itself) starts alongside `getProposalDetail()`,
  // rather than waiting on it first. Flagged by the Build 22 performance
  // review: this page previously fully awaited `getProposalDetail()`
  // before starting `listProposalVersions()`/`listAssignableUsers()`,
  // even though neither depends on the proposal's own data.
  const [detailResult, versions, users] = await Promise.all([
    getProposalDetail({ proposalId: id }).catch((error) => {
      if (toAppError(error).code === "NOT_FOUND") notFound();
      throw error;
    }),
    listProposalVersions({ proposalId: id }),
    canManage ? listAssignableUsers() : Promise.resolve([]),
  ]);
  const { proposal, currentVersion } = detailResult;

  // Stage 2 — depends on the now-resolved proposal (`companyId`/`dealId`).
  // Contacts are only ever rendered when the proposal is SENT (the
  // acceptance form's own recipient picker) — gated here too, not just
  // in the JSX, so a DRAFT/ACCEPTED/REJECTED/EXPIRED proposal's page load
  // never pays for a company-validation + contacts query it can't use.
  // Also flagged by the Build 22 performance review.
  const [contacts, contracts] = await Promise.all([
    canManage && proposal.status === "SENT" ? listContactsForCompany({ companyId: proposal.companyId }) : Promise.resolve([]),
    listContracts({ dealId: proposal.dealId }),
  ]);

  const linkedContract = contracts.find((c) => c.originatingProposalId === proposal.id);
  // Server-side self-approval visibility courtesy — the real enforcement
  // is inside `decideProposalApproval()` itself (see that function's own
  // comment); hiding the control here just avoids showing a submitter a
  // button that will always fail.
  const isOwnApprovalRequest = currentVersion?.approvalSubmittedByUserId === context.user?.id;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={proposal.proposalNumber}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: proposal.proposalNumber }]}
        actions={<StatusBadge status={proposalStatusVariant(proposal.status)}>{proposal.status}</StatusBadge>}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Deal</span>
              <Link href={`/admin/crm/deals/${proposal.dealId}`} className="hover:underline">
                View deal
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Company</span>
              <Link href={`/admin/crm/companies/${proposal.company.id}`} className="hover:underline">
                {proposal.company.name}
              </Link>
            </div>
            {proposal.primaryContact ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Recipient</span>
                <Link href={`/admin/crm/contacts/${proposal.primaryContact.id}`} className="hover:underline">
                  {proposal.primaryContact.firstName} {proposal.primaryContact.lastName}
                </Link>
              </div>
            ) : null}
            {currentVersion ? (
              <>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold tabular-nums">{formatMoney(currentVersion.totalMinorUnits, currentVersion.currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Valid until</span>
                  <span>{formatInTimeZone(currentVersion.validUntil, "UTC")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Internal approval</span>
                  <StatusBadge status={approvalStatusVariant(currentVersion.approvalStatus)}>{currentVersion.approvalStatus}</StatusBadge>
                </div>
              </>
            ) : null}
            {linkedContract ? (
              <div className="flex items-center justify-between pt-2">
                <span className="text-muted-foreground">Contract</span>
                <Link href={`/admin/crm/contracts/${linkedContract.id}`} className="hover:underline">
                  {linkedContract.contractNumber} <StatusBadge status={contractStatusVariant(linkedContract.status)}>{linkedContract.status}</StatusBadge>
                </Link>
              </div>
            ) : proposal.status === "ACCEPTED" && canCreateContract ? (
              <Button asChild size="sm" className="mt-2 w-fit">
                <Link href={`/admin/crm/contracts/new?proposalId=${proposal.id}`}>Create contract</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {canManage ? (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <span className="text-sm text-muted-foreground">Assigned rep</span>
                <ProposalAssigneeControl proposalId={proposal.id} assignedToUserId={proposal.assignedToUserId} users={users} />
              </CardContent>
            </Card>
          ) : null}
          {canApprove && !isOwnApprovalRequest && currentVersion?.approvalStatus === "PENDING" ? (
            <Card>
              <CardContent>
                <ProposalApprovalControls proposalId={proposal.id} version={currentVersion} />
              </CardContent>
            </Card>
          ) : null}
          {canManage ? (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <span className="text-sm text-muted-foreground">Actions</span>
                <ProposalLifecycleControls proposal={proposal} version={currentVersion} />
              </CardContent>
            </Card>
          ) : null}
          {canManage && proposal.status === "SENT" ? (
            <Card>
              <CardContent>
                <ProposalAcceptForm proposalId={proposal.id} contacts={contacts} defaultContactId={proposal.primaryContactId} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      {currentVersion ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title={currentVersion.title} description={`Version ${currentVersion.versionNumber}`} />
          <Card>
            <CardContent className="flex flex-col gap-4">
              <SanitizedHtmlView html={currentVersion.bodyHtml} className="prose prose-sm max-w-none dark:prose-invert" />
              {currentVersion.termsHtml ? (
                <div className="border-t border-border pt-4">
                  <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Terms</p>
                  <SanitizedHtmlView html={currentVersion.termsHtml} className="prose prose-sm max-w-none dark:prose-invert" />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Line items table, scrollable on narrow viewports">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Item</th>
                  <th className="px-4 py-2.5">Qty</th>
                  <th className="px-4 py-2.5">Unit price</th>
                  <th className="px-4 py-2.5">Discount</th>
                  <th className="px-4 py-2.5 text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {currentVersion.lineItems.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-medium">{item.title}</span>
                        {item.description ? <span className="text-xs text-muted-foreground">{item.description}</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{item.quantity}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatMoney(item.unitAmountMinorUnits, currentVersion.currency)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.discountType === "NONE" ? "—" : item.discountType === "PERCENT" ? `${item.discountValue}%` : formatMoney(item.discountValue ?? 0, currentVersion.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(item.lineTotalMinorUnits, currentVersion.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">
                    Subtotal
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(currentVersion.subtotalMinorUnits, currentVersion.currency)}</td>
                </tr>
                {currentVersion.discountType !== "NONE" ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">
                      Proposal discount ({currentVersion.discountType === "PERCENT" ? `${currentVersion.discountValue}%` : formatMoney(currentVersion.discountValue ?? 0, currentVersion.currency)})
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(currentVersion.discountedSubtotalMinorUnits - currentVersion.subtotalMinorUnits, currentVersion.currency)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-muted-foreground">
                    Tax
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{currentVersion.taxAmountMinorUnits === null ? <span className="text-xs italic text-muted-foreground">Not calculated</span> : formatMoney(currentVersion.taxAmountMinorUnits, currentVersion.currency)}</td>
                </tr>
                <tr className="border-t border-border font-semibold">
                  <td colSpan={4} className="px-4 py-2.5 text-right">
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(currentVersion.totalMinorUnits, currentVersion.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {currentVersion.status === "ACCEPTED" ? (
            <Card>
              <CardContent className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-success">Accepted</span>
                <span className="text-muted-foreground">
                  By {currentVersion.acceptedSignerName} ({currentVersion.acceptedSignerEmail}) on {currentVersion.acceptedAt ? formatInTimeZone(currentVersion.acceptedAt, "UTC") : "—"}
                </span>
                <span className="text-xs text-muted-foreground">Recorded internally by {currentVersion.acceptedByStaffUser?.name ?? "—"} — not a live e-signature capture.</span>
              </CardContent>
            </Card>
          ) : null}
          {currentVersion.status === "REJECTED" && currentVersion.rejectedReason ? (
            <Card>
              <CardContent className="text-sm">
                <span className="font-medium text-destructive">Rejected: </span>
                <span className="text-muted-foreground">{currentVersion.rejectedReason}</span>
              </CardContent>
            </Card>
          ) : null}

          <Link href={`/admin/crm/proposals/${proposal.id}/print`} className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:underline" target="_blank" rel="noopener noreferrer">
            <FileText className="size-3.5" aria-hidden="true" /> Open print-ready view
          </Link>
        </section>
      ) : (
        <EmptyState icon={FileText} title="This proposal has no current version" />
      )}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Version history" description="Every version is immutable once sent — a revision always creates a new version rather than editing history." />
        <ProposalVersionHistory versions={versions} currentVersionId={proposal.currentVersionId} />
      </section>
    </div>
  );
}
