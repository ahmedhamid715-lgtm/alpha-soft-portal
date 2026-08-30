/**
 * Build 20 (Roadmap Module 14 — Sales Pipeline) dev fixtures — one real
 * pipeline with its default 6-stage set, and a few realistic deals
 * against the companies/leads `seed-crm.ts` already seeded. Every row
 * belongs to the ONE platform organization, same invariant every CRM/
 * Sales Pipeline table shares — see docs/architecture/sales-pipeline.md.
 *
 * Deliberately uses the REPOSITORY layer directly, never the
 * `crm-*-service.ts`/`crm-deal-service.ts` layer — same reasoning
 * `seed-crm.ts`'s own top comment documents: the service layer
 * transitively imports `requirePermission()` -> `session-guard` ->
 * next-auth's own module graph, which doesn't work inside this bare
 * `tsx` process.
 *
 * Idempotent: guarded by a single find-or-skip check on the default
 * pipeline's own name, the same "one guard for the whole fixture set"
 * pattern `seed-crm.ts` uses.
 */
import { generateId } from "../src/lib/utils/id";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { userRepository } from "../src/server/repositories/user-repository";
import { crmCompanyRepository } from "../src/server/repositories/crm-company-repository";
import { crmLeadRepository } from "../src/server/repositories/crm-lead-repository";
import { crmPipelineRepository } from "../src/server/repositories/crm-pipeline-repository";
import { crmPipelineStageRepository } from "../src/server/repositories/crm-pipeline-stage-repository";
import { crmDealRepository } from "../src/server/repositories/crm-deal-repository";
import { crmDealHistoryRepository } from "../src/server/repositories/crm-deal-history-repository";

const DEFAULT_STAGES: { name: string; defaultProbability: number | null; isWon?: boolean; isLost?: boolean }[] = [
  { name: "New", defaultProbability: 10 },
  { name: "Qualifying", defaultProbability: 25 },
  { name: "Proposal", defaultProbability: 50 },
  { name: "Negotiation", defaultProbability: 75 },
  { name: "Closed Won", defaultProbability: 100, isWon: true },
  { name: "Closed Lost", defaultProbability: 0, isLost: true },
];

export async function seedPipelineFixtures(): Promise<void> {
  const platformOrg = await organizationRepository.findBySlug("alpha-os-platform");
  if (!platformOrg) {
    console.log("[seed-pipeline] Platform organization not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const existing = await crmPipelineRepository.findDefault(platformOrg.id);
  if (existing) {
    console.log("[seed-pipeline] Sales pipeline fixtures already exist — nothing to do.");
    return;
  }

  const platformAdmin = await userRepository.findByEmail("platform-admin@alpha-os.test");
  if (!platformAdmin) {
    console.log("[seed-pipeline] Platform dev accounts not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const companies = await crmCompanyRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 });
  const acmeCompany = companies.items.find((c) => c.name === "Acme Retail Group");
  const globexCompany = companies.items.find((c) => c.name === "Globex Logistics");
  if (!acmeCompany || !globexCompany) {
    console.log("[seed-pipeline] CRM company fixtures not found — run seedCrmFixtures() first. Skipping.");
    return;
  }

  const pipeline = await crmPipelineRepository.create({ id: generateId(), organizationId: platformOrg.id, name: "Sales Pipeline", isDefault: true });
  const stages = await Promise.all(
    DEFAULT_STAGES.map((stage, index) =>
      crmPipelineStageRepository.create({ id: generateId(), organizationId: platformOrg.id, pipelineId: pipeline.id, name: stage.name, sortOrder: (index + 1) * 1000, isWon: stage.isWon, isLost: stage.isLost, defaultProbability: stage.defaultProbability }),
    ),
  );
  const stageByName = new Map(stages.map((s) => [s.name, s]));

  const qualifyingStage = stageByName.get("Qualifying")!;
  const negotiationStage = stageByName.get("Negotiation")!;
  const closedWonStage = stageByName.get("Closed Won")!;

  const qualifiedLead = (await crmLeadRepository.listForOrganization(platformOrg.id, { page: 1, limit: 10 }, { status: "QUALIFIED" })).items[0];

  const openDeal = await crmDealRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    pipelineId: pipeline.id,
    stageId: negotiationStage.id,
    companyId: globexCompany.id,
    primaryContactId: null,
    sourceLeadId: null,
    title: "Technical SEO retainer — Globex Logistics",
    valueMinorUnits: 1_200_000,
    currency: "USD",
    probability: 75,
    expectedCloseDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
    assignedToUserId: platformAdmin.id,
  });
  await crmDealHistoryRepository.create({ id: generateId(), organizationId: platformOrg.id, dealId: openDeal.id, type: "CREATED", metadata: { title: openDeal.title }, note: null, actorUserId: platformAdmin.id });

  if (qualifiedLead) {
    const sourcedDeal = await crmDealRepository.create({
      id: generateId(),
      organizationId: platformOrg.id,
      pipelineId: pipeline.id,
      stageId: qualifyingStage.id,
      companyId: acmeCompany.id,
      primaryContactId: qualifiedLead.primaryContactId,
      sourceLeadId: qualifiedLead.id,
      title: qualifiedLead.title,
      valueMinorUnits: 850_000,
      currency: "USD",
      probability: 25,
      expectedCloseDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      assignedToUserId: platformAdmin.id,
    });
    await crmDealHistoryRepository.create({ id: generateId(), organizationId: platformOrg.id, dealId: sourcedDeal.id, type: "CREATED", metadata: { title: sourcedDeal.title, sourceLeadId: qualifiedLead.id }, note: null, actorUserId: platformAdmin.id });
  }

  const wonDeal = await crmDealRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    pipelineId: pipeline.id,
    stageId: closedWonStage.id,
    companyId: acmeCompany.id,
    primaryContactId: null,
    sourceLeadId: null,
    title: "Local landing pages — Acme Retail Group (Q1)",
    valueMinorUnits: 450_000,
    currency: "USD",
    probability: 100,
    expectedCloseDate: null,
    assignedToUserId: platformAdmin.id,
  });
  const won = await crmDealRepository.win(wonDeal.id, closedWonStage.id);
  await crmDealHistoryRepository.create({ id: generateId(), organizationId: platformOrg.id, dealId: wonDeal.id, type: "CREATED", metadata: { title: wonDeal.title }, note: null, actorUserId: platformAdmin.id });
  await crmDealHistoryRepository.create({ id: generateId(), organizationId: platformOrg.id, dealId: wonDeal.id, type: "WON", metadata: { stageId: closedWonStage.id }, note: null, actorUserId: platformAdmin.id });

  console.log(`[seed-pipeline] Sales pipeline fixtures seeded for platform organization (${platformOrg.id}): 1 pipeline, 6 stages, 3 deals (1 open, 1 sourced from a lead, 1 won=${Boolean(won)}).`);
}
