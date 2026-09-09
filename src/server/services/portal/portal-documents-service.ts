import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withPortalCrmReadContext, resolvePortalCrmCompany, resolvePortalCurrentOnboarding } from "./portal-crm-bridge";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmProposalVersionRepository } from "@/server/repositories/crm-proposal-version-repository";
import { crmProposalLineItemRepository } from "@/server/repositories/crm-proposal-line-item-repository";
import { crmContractRepository } from "@/server/repositories/crm-contract-repository";
import { crmClientOnboardingDocumentRepository } from "@/server/repositories/crm-client-onboarding-document-repository";
import type { CrmCompany, CrmProposalStatus, CrmClientOnboardingDocumentStatus } from "@/generated/prisma/client";

/**
 * Customer-safe commercial/document projections (Build 26). No real
 * file storage exists yet (Roadmap Module 56 — every `StorageProvider`
 * method throws `StorageNotConfiguredError`; `CrmClientOnboardingDocument.fileKey`
 * is always `null` — see that model's own schema comment). This is why
 * every "document" here is a structured, already-sanitized data
 * projection (proposal `bodyHtml` is sanitized server-side at write
 * time — see `CrmProposalVersion.bodyHtml`'s own schema comment — safe
 * to render as-is) rather than a download link: there is nothing to
 * download yet, and this build does not fake a download button that
 * goes nowhere.
 */
export interface PortalProposalDocument {
  proposalNumber: string;
  title: string;
  bodyHtml: string;
  termsHtml: string | null;
  currency: string;
  totalMinorUnits: number;
  acceptedAt: Date | null;
  lineItems: { title: string; description: string | null; quantity: number; unitAmountMinorUnits: number; lineTotalMinorUnits: number }[];
}

export interface PortalContractDocument {
  contractNumber: string;
  status: string;
  effectiveDate: Date | null;
  endDate: Date | null;
  renewalTerms: string | null;
  activatedAt: Date | null;
}

export interface PortalOnboardingDocumentReference {
  title: string;
  description: string | null;
  status: CrmClientOnboardingDocumentStatus;
  receivedAt: Date | null;
}

export interface PortalDocuments {
  proposal: PortalProposalDocument | null;
  contracts: PortalContractDocument[];
  onboardingDocuments: PortalOnboardingDocumentReference[];
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });
const ACCEPTED: CrmProposalStatus = "ACCEPTED";

export async function getPortalDocuments(rawInput: unknown, precomputedCrmCompany?: CrmCompany | null): Promise<PortalDocuments> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;

  // Codex Performance Engineer finding — same short-circuit as
  // `getPortalOnboardingStatus()`'s own identical comment.
  if (precomputedCrmCompany === null) return { proposal: null, contracts: [], onboardingDocuments: [] };

  return withPortalCrmReadContext(userId, async (tx) => {
    const crmCompany = precomputedCrmCompany !== undefined ? precomputedCrmCompany : await resolvePortalCrmCompany(input.organizationId, userId, tx);
    if (!crmCompany) return { proposal: null, contracts: [], onboardingDocuments: [] };

    const [proposals, contracts, onboarding] = await Promise.all([
      crmProposalRepository.listForOrganization(crmCompany.organizationId, { companyId: crmCompany.id, status: ACCEPTED }, tx),
      crmContractRepository.listForOrganization(crmCompany.organizationId, { companyId: crmCompany.id }, tx),
      resolvePortalCurrentOnboarding(crmCompany, tx),
    ]);

    // Codex Performance Engineer finding — the proposal-version/line-item
    // chain (depends on `proposals`) and the onboarding-document read
    // (depends only on `onboarding`, already resolved above) are
    // independent; run them concurrently rather than the version chain
    // finishing first.
    const acceptedProposal = proposals[0] ?? null;
    const [version, onboardingDocuments] = await Promise.all([
      acceptedProposal?.currentVersionId ? crmProposalVersionRepository.findById(acceptedProposal.currentVersionId, tx) : Promise.resolve(null),
      onboarding ? crmClientOnboardingDocumentRepository.listForOnboarding(onboarding.id, tx) : Promise.resolve([]),
    ]);

    let proposal: PortalProposalDocument | null = null;
    if (acceptedProposal && version) {
      const lineItems = await crmProposalLineItemRepository.listForVersion(version.id, tx);
      proposal = {
        proposalNumber: acceptedProposal.proposalNumber,
        title: version.title,
        bodyHtml: version.bodyHtml,
        termsHtml: version.termsHtml,
        currency: version.currency,
        totalMinorUnits: version.totalMinorUnits,
        acceptedAt: version.acceptedAt,
        lineItems: lineItems.map((li) => ({ title: li.title, description: li.description, quantity: li.quantity, unitAmountMinorUnits: li.unitAmountMinorUnits, lineTotalMinorUnits: li.lineTotalMinorUnits })),
      };
    }

    // Codex Security Engineer finding (Medium) — DRAFT contracts are
    // internal, never-sent negotiation state (no customer commitment
    // exists yet); showing one to the customer would be actively
    // misleading, not just premature. Every OTHER status
    // (ACTIVE/EXPIRED/TERMINATED/CANCELLED) is a real, settled fact
    // about the customer's own account and stays visible.
    const contractDocs: PortalContractDocument[] = contracts
      .filter((c) => c.status !== "DRAFT")
      .map((c) => ({
        contractNumber: c.contractNumber,
        status: c.status,
        effectiveDate: c.effectiveDate,
        endDate: c.endDate,
        renewalTerms: c.renewalTerms,
        activatedAt: c.activatedAt,
      }));

    return {
      proposal,
      contracts: contractDocs,
      onboardingDocuments: onboardingDocuments.map((d) => ({ title: d.title, description: d.description, status: d.status, receivedAt: d.receivedAt })),
    };
  });
}
