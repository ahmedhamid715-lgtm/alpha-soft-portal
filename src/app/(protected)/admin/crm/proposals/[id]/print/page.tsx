import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getProposalDetail } from "@/server/services/crm-proposal-service";
import { toAppError } from "@/lib/errors/app-error";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { SanitizedHtmlView } from "@/components/crm/proposals/sanitized-html-view";

export const metadata: Metadata = { title: "Proposal (Print)" };

/**
 * Print-ready HTML, not a generated PDF — Build 22 has no real PDF-
 * rendering/storage infrastructure to build on (see
 * docs/architecture/proposals-contracts.md "Document/PDF boundary"), so
 * this honestly provides a clean, print-styled page a staff member can
 * save as PDF via the browser's own "Print > Save as PDF," rather than
 * claiming a PDF capability that doesn't exist. Deliberately minimal —
 * no app chrome, `@media print` rules hide anything that shouldn't
 * appear on paper (there is nothing but content here to begin with).
 */
export default async function ProposalPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();
  if (!context.permissions.has("crm.proposal.read")) notFound();

  let detail;
  try {
    detail = await getProposalDetail({ proposalId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
  const { proposal, currentVersion } = detail;
  if (!currentVersion) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8 text-sm text-foreground print:p-0">
      <div className="flex items-start justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold">{currentVersion.title}</h1>
          <p className="text-muted-foreground">{proposal.proposalNumber}</p>
        </div>
        <div className="text-right text-muted-foreground">
          <p>Prepared for</p>
          <p className="font-medium text-foreground">{proposal.company.name}</p>
          {proposal.primaryContact ? (
            <p>
              {proposal.primaryContact.firstName} {proposal.primaryContact.lastName}
            </p>
          ) : null}
        </div>
      </div>

      <SanitizedHtmlView html={currentVersion.bodyHtml} className="prose prose-sm max-w-none" />

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-1.5">Item</th>
            <th className="py-1.5">Qty</th>
            <th className="py-1.5">Unit price</th>
            <th className="py-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {currentVersion.lineItems.map((item) => (
            <tr key={item.id} className="border-b border-border">
              <td className="py-1.5">
                {item.title}
                {item.description ? <div className="text-xs text-muted-foreground">{item.description}</div> : null}
              </td>
              <td className="py-1.5">{item.quantity}</td>
              <td className="py-1.5">{formatMoney(item.unitAmountMinorUnits, currentVersion.currency)}</td>
              <td className="py-1.5 text-right">{formatMoney(item.lineTotalMinorUnits, currentVersion.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col items-end gap-1">
        <div className="flex w-56 justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatMoney(currentVersion.subtotalMinorUnits, currentVersion.currency)}</span>
        </div>
        {currentVersion.discountType !== "NONE" ? (
          <div className="flex w-56 justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span>-{formatMoney(currentVersion.subtotalMinorUnits - currentVersion.discountedSubtotalMinorUnits, currentVersion.currency)}</span>
          </div>
        ) : null}
        <div className="flex w-56 justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span>{currentVersion.taxAmountMinorUnits === null ? "Not calculated" : formatMoney(currentVersion.taxAmountMinorUnits, currentVersion.currency)}</span>
        </div>
        <div className="flex w-56 justify-between border-t border-border pt-1 font-semibold">
          <span>Total</span>
          <span>{formatMoney(currentVersion.totalMinorUnits, currentVersion.currency)}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Valid until {formatInTimeZone(currentVersion.validUntil, "UTC")}.</p>

      {currentVersion.termsHtml ? (
        <div className="border-t border-border pt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Terms</p>
          <SanitizedHtmlView html={currentVersion.termsHtml} className="prose prose-sm max-w-none" />
        </div>
      ) : null}
    </div>
  );
}
