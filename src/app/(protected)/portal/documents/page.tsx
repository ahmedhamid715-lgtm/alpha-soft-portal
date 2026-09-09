import type { Metadata } from "next";
import { FileText, FileSignature } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getPortalDocuments } from "@/server/services/portal/portal-documents-service";
import { formatMoney } from "@/lib/utils/money";
import { SanitizedHtmlView } from "@/components/crm/proposals/sanitized-html-view";

export const metadata: Metadata = { title: "Documents" };

const CONTRACT_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = {
  ACTIVE: "success",
  DRAFT: "neutral",
  TERMINATED: "destructive",
  CANCELLED: "neutral",
  EXPIRED: "warning",
};

const ONBOARDING_DOC_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = {
  REQUESTED: "warning",
  RECEIVED: "success",
  WAIVED: "neutral",
};

/**
 * Documents (Build 26) — real, customer-safe metadata projections only.
 * No real file storage exists yet (Roadmap Module 56) — see
 * `portal-documents-service.ts`'s own top comment — so nothing here
 * pretends to offer a download.
 */
export default async function PortalDocumentsPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Documents" />;

  const documents = await getPortalDocuments({ organizationId: guard.organizationId });
  const nothingAtAll = !documents.proposal && documents.contracts.length === 0 && documents.onboardingDocuments.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Documents" description="Your accepted proposal, contract, and onboarding document references." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Documents" }]} />

      {nothingAtAll ? (
        <EmptyState icon={FileText} title="No documents yet" description="Documents will appear here once a proposal is accepted or a contract is active." />
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-1.5">
              <FileSignature className="size-4 text-muted-foreground" aria-hidden="true" />
              <SectionHeader title="Accepted proposal" className="flex-1" />
            </div>
            {!documents.proposal ? (
              <EmptyState icon={FileSignature} title="No accepted proposal on file" />
            ) : (
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{documents.proposal.proposalNumber} — {documents.proposal.title}</span>
                    <span className="text-sm text-muted-foreground">{formatMoney(documents.proposal.totalMinorUnits, documents.proposal.currency)}</span>
                  </div>
                  <SanitizedHtmlView html={documents.proposal.bodyHtml} className="prose prose-sm max-w-none dark:prose-invert" />
                  {documents.proposal.lineItems.length > 0 ? (
                    <div className="flex flex-col gap-1 border-t border-border pt-3">
                      {documents.proposal.lineItems.map((li, i) => (
                        <div key={`${li.title}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                          <span>
                            {li.title} × {li.quantity}
                          </span>
                          <span className="text-muted-foreground">{formatMoney(li.lineTotalMinorUnits, documents.proposal!.currency)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader title="Contracts" />
            {documents.contracts.length === 0 ? (
              <EmptyState icon={FileSignature} title="No contracts on file" />
            ) : (
              <div className="flex flex-col gap-2">
                {documents.contracts.map((c) => (
                  <Card key={c.contractNumber}>
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{c.contractNumber}</span>
                      <div className="flex items-center gap-3">
                        {c.endDate ? <span className="text-xs text-muted-foreground">Ends {new Date(c.endDate).toLocaleDateString()}</span> : null}
                        <StatusBadge status={CONTRACT_STATUS_TONE[c.status] ?? "neutral"}>{c.status}</StatusBadge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader title="Onboarding documents" description="Reference only — file upload/download isn't available yet." />
            {documents.onboardingDocuments.length === 0 ? (
              <EmptyState icon={FileText} title="No onboarding documents on file" />
            ) : (
              <div className="flex flex-col gap-2">
                {documents.onboardingDocuments.map((d, i) => (
                  <Card key={`${d.title}-${i}`}>
                    <CardContent className="flex items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{d.title}</span>
                        {d.description ? <span className="text-xs text-muted-foreground">{d.description}</span> : null}
                      </div>
                      <StatusBadge status={ONBOARDING_DOC_STATUS_TONE[d.status] ?? "neutral"}>{d.status}</StatusBadge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
