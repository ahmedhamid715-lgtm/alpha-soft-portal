/**
 * Build 22 (Roadmap Module 16 — Proposals & Contracts) dev fixtures —
 * against the SAME deals/companies/contacts `seed-pipeline.ts`/
 * `seed-crm.ts` already seeded, so the proposal/contract UI reflects
 * real, already-seeded deal history rather than disconnected fixture
 * data (same reasoning `seed-sales-team.ts`'s own top comment
 * documents).
 *
 * Deliberately uses the REPOSITORY layer directly, never
 * `crm-proposal-service.ts`/`crm-contract-service.ts` — same reasoning
 * every prior CRM seed file documents (the service layer transitively
 * needs `requirePermission()` -> session-guard, which doesn't work
 * inside this bare `tsx` process). Pricing still goes through the real
 * `priceProposal()`/`applyTax()` pure functions (no service dependency),
 * so seeded totals are computed the exact same way production ones are,
 * never hand-typed.
 *
 * Three proposals, one per lifecycle stage the UI needs to render:
 *   1. ACCEPTED (Acme / the already-won deal) -> an ACTIVE Contract.
 *   2. SENT (Globex / the open deal) — awaiting acceptance.
 *   3. DRAFT (Globex / the open deal) — a second, still-being-drafted
 *      quote for the same deal, showing multiple proposals per deal is
 *      normal.
 *
 * Idempotent: guarded by a single find-or-skip check on the proposal
 * number sequence having already been used by this script (checked via
 * a known proposal title on the platform org), the same "one guard for
 * the whole fixture set" pattern every prior seed file uses.
 */
import { generateId } from "../src/lib/utils/id";
import { db } from "../src/lib/db/client";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { userRepository } from "../src/server/repositories/user-repository";
import { crmCompanyRepository } from "../src/server/repositories/crm-company-repository";
import { crmContactRepository } from "../src/server/repositories/crm-contact-repository";
import { crmDealRepository } from "../src/server/repositories/crm-deal-repository";
import { crmProposalRepository } from "../src/server/repositories/crm-proposal-repository";
import { crmProposalVersionRepository } from "../src/server/repositories/crm-proposal-version-repository";
import { crmProposalLineItemRepository, type CrmProposalLineItemWithoutIds } from "../src/server/repositories/crm-proposal-line-item-repository";
import { crmProposalTemplateRepository } from "../src/server/repositories/crm-proposal-template-repository";
import { crmContractRepository } from "../src/server/repositories/crm-contract-repository";
import { nextProposalNumber } from "../src/lib/crm/proposal-numbering";
import { nextContractNumber } from "../src/lib/crm/contract-numbering";
import { priceProposal, applyTax, type ProposalLineItemInput } from "../src/lib/crm/proposal-pricing";

const SEED_PROPOSAL_TITLE = "Local landing pages — Acme Retail Group (Q1)";

function priceAndBuildVersion(lineItemInputs: { title: string; description: string | null; quantity: number; unitAmountMinorUnits: number }[]): {
  lineItemRows: CrmProposalLineItemWithoutIds[];
  totals: { subtotalMinorUnits: number; discountedSubtotalMinorUnits: number; totalMinorUnits: number };
} {
  const pricingInputs: ProposalLineItemInput[] = lineItemInputs.map((item) => ({ quantity: item.quantity, unitAmountMinorUnits: item.unitAmountMinorUnits, discountType: "NONE", discountValue: null }));
  const { lineItems, totals } = priceProposal(pricingInputs, { discountType: "NONE", discountValue: null });
  const lineItemRows: CrmProposalLineItemWithoutIds[] = lineItems.map((priced, index) => ({
    title: lineItemInputs[index].title,
    description: lineItemInputs[index].description,
    quantity: priced.quantity,
    unitAmountMinorUnits: priced.unitAmountMinorUnits,
    discountType: priced.discountType,
    discountValue: priced.discountValue,
    lineTotalMinorUnits: priced.lineTotalMinorUnits,
    sortOrder: index,
  }));
  return { lineItemRows, totals };
}

export async function seedProposalsFixtures(): Promise<void> {
  const platformOrg = await organizationRepository.findBySlug("alpha-os-platform");
  if (!platformOrg) {
    console.log("[seed-proposals] Platform organization not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const existing = await db.crmProposal.findFirst({ where: { organizationId: platformOrg.id, proposalNumber: { startsWith: "PROP-" } } });
  if (existing) {
    console.log("[seed-proposals] Proposal fixtures already exist — nothing to do.");
    return;
  }

  const platformOwner = await userRepository.findByEmail("platform-owner@alpha-os.test");
  const platformAdmin = await userRepository.findByEmail("platform-admin@alpha-os.test");
  if (!platformOwner || !platformAdmin) {
    console.log("[seed-proposals] Platform dev accounts not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const companies = await crmCompanyRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 });
  const acme = companies.items.find((c) => c.name === "Acme Retail Group");
  const globex = companies.items.find((c) => c.name === "Globex Logistics");
  if (!acme || !globex) {
    console.log("[seed-proposals] CRM company fixtures not found — run seedCrmFixtures() first. Skipping.");
    return;
  }

  const acmeContacts = await crmContactRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 }, { companyId: acme.id });
  const globexContacts = await crmContactRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 }, { companyId: globex.id });
  const jordan = acmeContacts.items.find((c) => c.lastName === "Reyes");
  const priya = globexContacts.items.find((c) => c.lastName === "Nair");

  const wonDeal = (await crmDealRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 }, { companyId: acme.id, status: "WON" })).items.find((d) => d.title === SEED_PROPOSAL_TITLE);
  const openDeal = (await crmDealRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 }, { companyId: globex.id, status: "OPEN" })).items[0];
  if (!wonDeal || !openDeal) {
    console.log("[seed-proposals] Sales pipeline deal fixtures not found — run seedPipelineFixtures() first. Skipping.");
    return;
  }

  const template = await crmProposalTemplateRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    name: "Standard SEO Services",
    defaultTitle: "SEO & Digital Marketing Services Proposal",
    defaultBodyHtml: "<p>Thank you for the opportunity to work with your team. This proposal outlines our recommended scope of services.</p>",
    defaultTermsHtml: "<p>Payment due net 30. This quote is valid for 30 days from the date issued.</p>",
    defaultValidityDays: 30,
  });

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // --- 1. ACCEPTED proposal (Acme / won deal) -> ACTIVE contract.
  {
    const { lineItemRows, totals } = priceAndBuildVersion([
      { title: "Local landing page build (5 pages)", description: "SEO-optimized, mobile-first landing pages targeting core service areas.", quantity: 5, unitAmountMinorUnits: 60_000 },
      { title: "On-page SEO audit & implementation", description: null, quantity: 1, unitAmountMinorUnits: 150_000 },
    ]);
    const totalMinorUnits = applyTax(totals.discountedSubtotalMinorUnits, null);

    const proposalId = generateId();
    const versionId = generateId();
    const proposalNumber = await nextProposalNumber();
    await crmProposalRepository.create({ id: proposalId, organizationId: platformOrg.id, dealId: wonDeal.id, companyId: acme.id, primaryContactId: jordan?.id ?? null, proposalNumber, templateId: template.id, assignedToUserId: platformAdmin.id });
    await crmProposalVersionRepository.create({
      id: versionId,
      organizationId: platformOrg.id,
      proposalId,
      versionNumber: 1,
      title: "SEO & Digital Marketing Services — Acme Retail Group",
      bodyHtml: "<p>Thank you for the opportunity to work with Acme Retail Group. This proposal outlines our recommended scope of services for Q1.</p>",
      termsHtml: "<p>Payment due net 30. This quote is valid for 30 days from the date issued.</p>",
      currency: "USD",
      subtotalMinorUnits: totals.subtotalMinorUnits,
      discountType: "NONE",
      discountValue: null,
      discountedSubtotalMinorUnits: totals.discountedSubtotalMinorUnits,
      taxAmountMinorUnits: null,
      totalMinorUnits,
      validUntil: new Date(now + 30 * day),
      createdByUserId: platformAdmin.id,
    });
    await db.$transaction((tx) => crmProposalLineItemRepository.replaceForVersion(versionId, platformOrg.id, lineItemRows, tx));
    await crmProposalRepository.setCurrentVersion(proposalId, versionId);
    await crmProposalVersionRepository.markSent(versionId, platformAdmin.id);
    await crmProposalRepository.setStatus(proposalId, "SENT");
    await crmProposalVersionRepository.markAccepted(versionId, { acceptedByContactId: jordan?.id ?? null, acceptedSignerName: jordan ? `${jordan.firstName} ${jordan.lastName}` : "Jordan Reyes", acceptedSignerEmail: jordan?.email ?? "jordan.reyes@acmeretail.example", acceptedByStaffUserId: platformAdmin.id, acceptanceMechanism: "INTERNAL_RECORDED" });
    const acceptedProposal = await crmProposalRepository.transitionTerminal(proposalId, "SENT", { status: "ACCEPTED", acceptedAt: new Date() });

    if (acceptedProposal) {
      const contractId = generateId();
      const contractNumber = await nextContractNumber();
      await crmContractRepository.create({ id: contractId, organizationId: platformOrg.id, dealId: wonDeal.id, companyId: acme.id, originatingProposalId: proposalId, originatingProposalVersionId: versionId, contractNumber, effectiveDate: new Date(), endDate: null, renewalTerms: "Auto-renews quarterly unless 30 days' written notice is given.", createdByUserId: platformAdmin.id });
      await crmContractRepository.activate(contractId, new Date());
    }
  }

  // --- 2. SENT proposal (Globex / open deal) — awaiting acceptance.
  {
    const { lineItemRows, totals } = priceAndBuildVersion([{ title: "Technical SEO retainer (monthly)", description: "Ongoing technical SEO, Core Web Vitals monitoring, and monthly reporting.", quantity: 1, unitAmountMinorUnits: 1_200_000 }]);
    const totalMinorUnits = applyTax(totals.discountedSubtotalMinorUnits, null);

    const proposalId = generateId();
    const versionId = generateId();
    const proposalNumber = await nextProposalNumber();
    await crmProposalRepository.create({ id: proposalId, organizationId: platformOrg.id, dealId: openDeal.id, companyId: globex.id, primaryContactId: priya?.id ?? null, proposalNumber, templateId: null, assignedToUserId: platformAdmin.id });
    await crmProposalVersionRepository.create({
      id: versionId,
      organizationId: platformOrg.id,
      proposalId,
      versionNumber: 1,
      title: "Technical SEO Retainer — Globex Logistics",
      bodyHtml: "<p>Proposed monthly technical SEO retainer covering Core Web Vitals, crawl health, and structured data.</p>",
      termsHtml: "<p>Month-to-month, cancel with 30 days' notice.</p>",
      currency: "USD",
      subtotalMinorUnits: totals.subtotalMinorUnits,
      discountType: "NONE",
      discountValue: null,
      discountedSubtotalMinorUnits: totals.discountedSubtotalMinorUnits,
      taxAmountMinorUnits: null,
      totalMinorUnits,
      validUntil: new Date(now + 21 * day),
      createdByUserId: platformAdmin.id,
    });
    await db.$transaction((tx) => crmProposalLineItemRepository.replaceForVersion(versionId, platformOrg.id, lineItemRows, tx));
    await crmProposalRepository.setCurrentVersion(proposalId, versionId);
    await crmProposalVersionRepository.markSent(versionId, platformAdmin.id);
    await crmProposalRepository.setStatus(proposalId, "SENT");
  }

  // --- 3. DRAFT proposal (Globex / same open deal) — a second, still-in-progress quote.
  {
    const { lineItemRows, totals } = priceAndBuildVersion([{ title: "Local citation cleanup & rebuild", description: null, quantity: 1, unitAmountMinorUnits: 90_000 }]);
    const totalMinorUnits = applyTax(totals.discountedSubtotalMinorUnits, null);

    const proposalId = generateId();
    const versionId = generateId();
    const proposalNumber = await nextProposalNumber();
    await crmProposalRepository.create({ id: proposalId, organizationId: platformOrg.id, dealId: openDeal.id, companyId: globex.id, primaryContactId: priya?.id ?? null, proposalNumber, templateId: null, assignedToUserId: platformOwner.id });
    await crmProposalVersionRepository.create({
      id: versionId,
      organizationId: platformOrg.id,
      proposalId,
      versionNumber: 1,
      title: "Local Citation Cleanup — Globex Logistics",
      bodyHtml: "<p>Draft scope — cleaning up and standardizing local business citations across major directories.</p>",
      termsHtml: null,
      currency: "USD",
      subtotalMinorUnits: totals.subtotalMinorUnits,
      discountType: "NONE",
      discountValue: null,
      discountedSubtotalMinorUnits: totals.discountedSubtotalMinorUnits,
      taxAmountMinorUnits: null,
      totalMinorUnits,
      validUntil: new Date(now + 30 * day),
      createdByUserId: platformOwner.id,
    });
    await db.$transaction((tx) => crmProposalLineItemRepository.replaceForVersion(versionId, platformOrg.id, lineItemRows, tx));
    await crmProposalRepository.setCurrentVersion(proposalId, versionId);
  }

  console.log(`[seed-proposals] Proposal/contract fixtures seeded for platform organization (${platformOrg.id}): 1 template, 3 proposals (1 accepted+contract, 1 sent, 1 draft).`);
}
