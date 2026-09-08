/**
 * Build 23 (Roadmap Module 17 — Client Onboarding) dev fixtures — against
 * the SAME WON deal/ACCEPTED proposal/ACTIVE contract `seed-proposals.ts`
 * already seeded for Acme Retail Group, so this module's own onboarding
 * UI reflects a real, already-seeded commercial history rather than
 * disconnected fixture data (same reasoning every prior Build 19-22 seed
 * file's own top comment documents).
 *
 * Deliberately uses the REPOSITORY layer directly, never
 * `crm-client-onboarding-service.ts` — same reasoning every prior CRM
 * seed file documents (the service layer transitively needs
 * `requirePermission()` -> session-guard, which doesn't work inside this
 * bare `tsx` process). This also means the CrmCompany -> Organization
 * conversion below is done by hand, directly, the one exception to
 * "never duplicate the service's own logic" this file makes — matching
 * `seed.ts`'s own top-level `createOrganizationWithOwner()` call, which
 * is itself the un-authorized, service-bypassing organization-creation
 * path every seed script already uses.
 *
 * One onboarding engagement, IN_PROGRESS, with a realistic mix of
 * complete/incomplete work so the detail page's own progress/completion
 * display has real, non-trivial state to render out of the box.
 */
import { generateId } from "../src/lib/utils/id";
import { db } from "../src/lib/db/client";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { userRepository } from "../src/server/repositories/user-repository";
import { crmCompanyRepository } from "../src/server/repositories/crm-company-repository";
import { crmDealRepository } from "../src/server/repositories/crm-deal-repository";
import { crmContractRepository } from "../src/server/repositories/crm-contract-repository";
import { crmProposalLineItemRepository } from "../src/server/repositories/crm-proposal-line-item-repository";
import { crmClientOnboardingRepository } from "../src/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingServiceItemRepository } from "../src/server/repositories/crm-client-onboarding-service-item-repository";
import { crmClientOnboardingChecklistItemRepository } from "../src/server/repositories/crm-client-onboarding-checklist-item-repository";
import { crmClientOnboardingRequirementRepository } from "../src/server/repositories/crm-client-onboarding-requirement-repository";
import { crmClientOnboardingIntakeFieldRepository } from "../src/server/repositories/crm-client-onboarding-intake-field-repository";
import { crmClientOnboardingIntakeResponseRepository } from "../src/server/repositories/crm-client-onboarding-intake-response-repository";
import { crmClientOnboardingAssignmentRepository } from "../src/server/repositories/crm-client-onboarding-assignment-repository";

const SEED_DEAL_TITLE = "Local landing pages — Acme Retail Group (Q1)";

export async function seedClientOnboardingFixtures(): Promise<void> {
  const platformOrg = await organizationRepository.findBySlug("alpha-os-platform");
  if (!platformOrg) {
    console.log("[seed-client-onboarding] Platform organization not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const platformOwner = await userRepository.findByEmail("platform-owner@alpha-os.test");
  const platformAdmin = await userRepository.findByEmail("platform-admin@alpha-os.test");
  if (!platformOwner || !platformAdmin) {
    console.log("[seed-client-onboarding] Platform dev accounts not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const wonDeal = (await crmDealRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 }, { status: "WON" })).items.find((d) => d.title === SEED_DEAL_TITLE);
  if (!wonDeal) {
    console.log("[seed-client-onboarding] Won deal fixture not found — run seedPipelineFixtures() first. Skipping.");
    return;
  }

  const existing = await crmClientOnboardingRepository.findActiveForDeal(wonDeal.id);
  if (existing) {
    console.log("[seed-client-onboarding] Onboarding fixture already exists — nothing to do.");
    return;
  }

  const company = await crmCompanyRepository.findById(wonDeal.companyId);
  if (!company) {
    console.log("[seed-client-onboarding] Company fixture not found. Skipping.");
    return;
  }

  const activeContract = (await crmContractRepository.listForOrganization(platformOrg.id, { dealId: wonDeal.id, status: "ACTIVE" }))[0];
  if (!activeContract) {
    console.log("[seed-client-onboarding] Active contract fixture not found — run seedProposalsFixtures() first. Skipping.");
    return;
  }

  // --- CrmCompany -> Organization conversion (see this file's own top
  // comment for why this is done by hand here, matching `seed.ts`'s own
  // un-authorized organization-creation precedent).
  let linkedOrganizationId = company.convertedToOrganizationId;
  if (!linkedOrganizationId) {
    const slugBase = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = (await organizationRepository.findBySlug(slugBase)) ? `${slugBase}-client` : slugBase;
    const newOrganization = await organizationRepository.create({ id: generateId(), name: company.name, displayName: company.name, slug });
    const linked = await db.$transaction((tx) => crmCompanyRepository.linkToOrganization(company.id, newOrganization.id, tx));
    if (!linked) {
      console.log("[seed-client-onboarding] Lost a conversion race against another seed run — nothing to do.");
      return;
    }
    linkedOrganizationId = newOrganization.id;
  }

  const onboardingId = generateId();
  await crmClientOnboardingRepository.create({
    id: onboardingId,
    organizationId: platformOrg.id,
    dealId: wonDeal.id,
    companyId: company.id,
    linkedOrganizationId,
    originatingContractId: activeContract.id,
    originatingProposalId: activeContract.originatingProposalId,
    createdByUserId: platformOwner.id,
  });
  await crmClientOnboardingRepository.setStatus(onboardingId, "IN_PROGRESS");

  // --- Service items, derived from the contract's own originating proposal version.
  if (activeContract.originatingProposalVersionId) {
    const lineItems = await crmProposalLineItemRepository.listForVersion(activeContract.originatingProposalVersionId);
    await db.$transaction((tx) =>
      crmClientOnboardingServiceItemRepository.createMany(
        onboardingId,
        platformOrg.id,
        lineItems.map((item) => ({ title: item.title, description: item.description, quantity: item.quantity, sourceLineItemId: item.id, onboardingRequired: true, notes: null })),
        tx,
      ),
    );
  }

  // --- Checklist — the same default template the real conversion service seeds, one already completed.
  await db.$transaction((tx) =>
    crmClientOnboardingChecklistItemRepository.createMany(
      onboardingId,
      platformOrg.id,
      [
        { title: "Confirm primary point of contact", description: null, required: true },
        { title: "Internal kickoff briefing", description: "The internal team is aligned on scope, services sold, and delivery plan before the client-facing kickoff.", required: true },
        { title: "Review sold services with client", description: null, required: true },
      ],
      tx,
    ),
  );
  const checklistItems = await crmClientOnboardingChecklistItemRepository.listForOnboarding(onboardingId);
  const firstItem = checklistItems[0];
  if (firstItem) await crmClientOnboardingChecklistItemRepository.complete(firstItem.id);

  // --- One requirement.
  await crmClientOnboardingRequirementRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    onboardingId,
    title: "Provide brand assets (logo, colors, fonts)",
    description: null,
    required: true,
    responsibleUserId: platformAdmin.id,
    dueDate: null,
    sortOrder: 0,
  });

  // --- A tenant-wide intake field (created once, reused across every onboarding).
  let intakeField = (await crmClientOnboardingIntakeFieldRepository.listForOrganization(platformOrg.id, "ACTIVE")).find((f) => f.label === "Primary billing contact email");
  if (!intakeField) {
    intakeField = await crmClientOnboardingIntakeFieldRepository.create({ id: generateId(), organizationId: platformOrg.id, label: "Primary billing contact email", fieldType: "EMAIL", required: true, options: null, sortOrder: 0 });
  }
  await crmClientOnboardingIntakeResponseRepository.upsert({ organizationId: platformOrg.id, onboardingId, fieldId: intakeField.id, value: "billing@acmeretail.example", respondedByUserId: platformOwner.id });

  // --- Team assignment.
  await crmClientOnboardingAssignmentRepository.upsert({ organizationId: platformOrg.id, onboardingId, role: "ACCOUNT_MANAGER", userId: platformAdmin.id, assignedByUserId: platformOwner.id });

  console.log(`[seed-client-onboarding] Onboarding fixture seeded for platform organization (${platformOrg.id}): 1 IN_PROGRESS engagement for ${company.name}, linked organization ${linkedOrganizationId}.`);
}
