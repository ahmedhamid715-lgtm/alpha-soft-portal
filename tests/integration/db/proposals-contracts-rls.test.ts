import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma, CrmProposalStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmProposalVersionRepository } from "@/server/repositories/crm-proposal-version-repository";
import { crmProposalTemplateRepository } from "@/server/repositories/crm-proposal-template-repository";
import { crmContractRepository } from "@/server/repositories/crm-contract-repository";

type ParentGraph = {
  organizationId: string;
  userId: string;
  companyId: string;
  otherCompanyId: string;
  contactId: string;
  otherCompanyContactId: string;
  dealId: string;
};

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };
const VALID_UNTIL = new Date("2027-12-31T23:59:59.000Z");

/** Collect the translated AppError plus its preserved Prisma/driver/Postgres causes. */
function errorDiagnostic(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();

  function visit(value: unknown, depth: number): void {
    if (value == null || depth > 8) return;
    if (typeof value !== "object") {
      parts.push(String(value));
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);

    if (value instanceof Error) {
      parts.push(value.name, value.message);
      visit(value.cause, depth + 1);
    }
    for (const [key, child] of Object.entries(value)) {
      parts.push(key);
      visit(child, depth + 1);
    }
  }

  visit(error, 0);
  return parts.join(" ");
}

async function expectPgError(promise: Promise<unknown>, sqlState?: string, messageFragment?: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database operation to be rejected").toBeDefined();
  const diagnostic = errorDiagnostic(caught);
  if (sqlState) expect(diagnostic).toContain(sqlState);
  if (messageFragment) expect(diagnostic.toLowerCase()).toContain(messageFragment.toLowerCase());
}

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Proposals & Contracts Row-Level Security (database integration)", () => {
  let platformOrgId: string;
  let customerOrgId: string;
  let platformUserId: string;
  let customerUserId: string;
  let platformGraph: ParentGraph;
  let customerGraph: ParentGraph;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const proposalIds: string[] = [];
  const versionIds: string[] = [];
  const lineItemIds: string[] = [];
  const templateIds: string[] = [];
  const contractIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });
  const customerContext = (): TenantContextInput => ({ userId: customerUserId, organizationId: customerOrgId, isPlatformStaff: false });
  // Build 22 rows are platform-only in addition to being tenant-owned. This
  // context keeps the platform predicate true while changing only the org,
  // which lets the matrix prove the organization predicate independently.
  const customerPlatformContext = (): TenantContextInput => ({ userId: customerUserId, organizationId: customerOrgId, isPlatformStaff: true });

  function contextFor(graph: ParentGraph): TenantContextInput {
    return graph.organizationId === platformOrgId ? platformContext() : customerPlatformContext();
  }

  beforeEach(async () => {
    platformOrgId = generateId();
    customerOrgId = generateId();
    organizationIds.push(platformOrgId, customerOrgId);

    await organizationRepository.create({
      id: platformOrgId,
      name: "Proposals RLS Org A",
      displayName: "Proposals RLS Org A",
      slug: `proposals-rls-a-${platformOrgId}`,
    });
    await organizationRepository.create({
      id: customerOrgId,
      name: "Proposals RLS Org B",
      displayName: "Proposals RLS Org B",
      slug: `proposals-rls-b-${customerOrgId}`,
    });

    platformUserId = generateId();
    customerUserId = generateId();
    userIds.push(platformUserId, customerUserId);
    await userRepository.create({ id: platformUserId, email: `proposals-rls-a-${platformUserId}@example.com`, name: "Proposal RLS Actor A" });
    await userRepository.create({ id: customerUserId, email: `proposals-rls-b-${customerUserId}@example.com`, name: "Proposal RLS Actor B" });

    platformGraph = await seedParentGraph(platformOrgId, platformUserId, platformContext());
    customerGraph = await seedParentGraph(customerOrgId, customerUserId, customerPlatformContext());
  });

  afterEach(async () => {
    // Scoped cleanup only. Build 22 children go first, then their CRM
    // fixture parents, users, and organizations.
    if (contractIds.length) await db.crmContract.deleteMany({ where: { id: { in: contractIds } } });
    if (lineItemIds.length) await db.crmProposalLineItem.deleteMany({ where: { id: { in: lineItemIds } } });
    if (proposalIds.length) await db.crmProposal.updateMany({ where: { id: { in: proposalIds } }, data: { currentVersionId: null } });
    if (versionIds.length) await db.crmProposalVersion.deleteMany({ where: { id: { in: versionIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (templateIds.length) await db.crmProposalTemplate.deleteMany({ where: { id: { in: templateIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (contactIds.length) await db.crmContact.deleteMany({ where: { id: { in: contactIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });

    for (const ids of [contractIds, lineItemIds, versionIds, proposalIds, templateIds, dealIds, stageIds, pipelineIds, contactIds, companyIds, userIds, organizationIds]) {
      ids.length = 0;
    }
  });

  async function seedParentGraph(organizationId: string, userId: string, context: TenantContextInput): Promise<ParentGraph> {
    const companyId = generateId();
    const otherCompanyId = generateId();
    const contactId = generateId();
    const otherCompanyContactId = generateId();
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    companyIds.push(companyId, otherCompanyId);
    contactIds.push(contactId, otherCompanyContactId);
    pipelineIds.push(pipelineId);
    stageIds.push(stageId);
    dealIds.push(dealId);

    await withTenantContext(context, async (tx) => {
      await tx.crmCompany.createMany({
        data: [
          { id: companyId, organizationId, name: `Proposal RLS Company ${companyId}` },
          { id: otherCompanyId, organizationId, name: `Proposal RLS Other Company ${otherCompanyId}` },
        ],
      });
      await tx.crmContact.createMany({
        data: [
          { id: contactId, organizationId, companyId, firstName: "Primary", lastName: "Contact" },
          { id: otherCompanyContactId, organizationId, companyId: otherCompanyId, firstName: "Other", lastName: "Contact" },
        ],
      });
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId, name: `Proposal RLS Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId, pipelineId, name: "Open", sortOrder: 1000 } });
      await tx.crmDeal.create({
        data: { id: dealId, organizationId, pipelineId, stageId, companyId, primaryContactId: contactId, title: "Proposal RLS Deal", assignedToUserId: userId },
      });
    });

    return { organizationId, userId, companyId, otherCompanyId, contactId, otherCompanyContactId, dealId };
  }

  async function seedTemplate(graph: ParentGraph) {
    const id = generateId();
    templateIds.push(id);
    return withTenantContext(contextFor(graph), (tx) =>
      crmProposalTemplateRepository.create(
        { id, organizationId: graph.organizationId, name: `Template ${id}`, defaultTitle: "Proposal", defaultBodyHtml: "<p>Body</p>", defaultTermsHtml: null, defaultValidityDays: 30 },
        tx,
      ),
    );
  }

  async function seedProposal(graph: ParentGraph, overrides: Partial<Prisma.CrmProposalUncheckedCreateInput> = {}) {
    const id = typeof overrides.id === "string" ? overrides.id : generateId();
    proposalIds.push(id);
    return withTenantContext(contextFor(graph), (tx) =>
      crmProposalRepository.create(
        {
          id,
          organizationId: graph.organizationId,
          dealId: graph.dealId,
          companyId: graph.companyId,
          primaryContactId: graph.contactId,
          proposalNumber: `PROP-${generateId()}`,
          templateId: null,
          assignedToUserId: graph.userId,
          ...overrides,
        },
        tx,
      ),
    );
  }

  function versionData(graph: ParentGraph, proposalId: string, versionNumber = 1): Prisma.CrmProposalVersionUncheckedCreateInput {
    return {
      id: generateId(),
      organizationId: graph.organizationId,
      proposalId,
      versionNumber,
      title: "Commercial Proposal",
      bodyHtml: "<p>Commercial body</p>",
      termsHtml: "<p>Net 30</p>",
      currency: "USD",
      subtotalMinorUnits: 10_000,
      discountType: "NONE",
      discountValue: null,
      discountedSubtotalMinorUnits: 10_000,
      taxAmountMinorUnits: 1_000,
      totalMinorUnits: 11_000,
      validUntil: VALID_UNTIL,
      createdByUserId: graph.userId,
    };
  }

  async function seedVersion(graph: ParentGraph, proposalId: string, versionNumber = 1) {
    const data = versionData(graph, proposalId, versionNumber);
    versionIds.push(data.id);
    // `versionData()` always sets a literal `termsHtml` string, but its
    // declared `Prisma.CrmProposalVersionUncheckedCreateInput` return type
    // widens that to `string | null | undefined` — narrower than
    // `crmProposalVersionRepository.create()`'s own required
    // `string | null` input. Asserting here (never actually `undefined` at
    // runtime) rather than loosening the repository's own real contract.
    return withTenantContext(contextFor(graph), (tx) => crmProposalVersionRepository.create(data as Parameters<typeof crmProposalVersionRepository.create>[0], tx));
  }

  async function createRawVersion(graph: ParentGraph, proposalId: string, overrides: Partial<Prisma.CrmProposalVersionUncheckedCreateInput>) {
    const data = { ...versionData(graph, proposalId), ...overrides } as Prisma.CrmProposalVersionUncheckedCreateInput;
    versionIds.push(data.id);
    return withTenantContext(contextFor(graph), (tx) => tx.crmProposalVersion.create({ data }));
  }

  function lineItemData(graph: ParentGraph, versionId: string): Prisma.CrmProposalLineItemUncheckedCreateInput {
    return {
      id: generateId(),
      organizationId: graph.organizationId,
      versionId,
      title: "Implementation",
      description: null,
      quantity: 1,
      unitAmountMinorUnits: 10_000,
      discountType: "NONE",
      discountValue: null,
      lineTotalMinorUnits: 10_000,
      sortOrder: 0,
    };
  }

  async function seedLineItem(graph: ParentGraph, versionId: string, overrides: Partial<Prisma.CrmProposalLineItemUncheckedCreateInput> = {}) {
    const data = { ...lineItemData(graph, versionId), ...overrides } as Prisma.CrmProposalLineItemUncheckedCreateInput;
    lineItemIds.push(data.id);
    return withTenantContext(contextFor(graph), (tx) => tx.crmProposalLineItem.create({ data }));
  }

  async function seedContract(
    graph: ParentGraph,
    origin: { proposalId: string; versionId: string } | null = null,
    overrides: Partial<Prisma.CrmContractUncheckedCreateInput> = {},
  ) {
    const id = typeof overrides.id === "string" ? overrides.id : generateId();
    contractIds.push(id);
    return withTenantContext(contextFor(graph), (tx) =>
      crmContractRepository.create(
        {
          id,
          organizationId: graph.organizationId,
          dealId: graph.dealId,
          companyId: graph.companyId,
          originatingProposalId: origin?.proposalId ?? null,
          originatingProposalVersionId: origin?.versionId ?? null,
          contractNumber: `CON-${generateId()}`,
          effectiveDate: null,
          endDate: null,
          renewalTerms: null,
          createdByUserId: graph.userId,
          ...overrides,
          // `overrides` is typed against Prisma's own broader
          // `Date | string | null` DateTime input; every actual override
          // used in this file passes a real `Date | null`, but
          // `crmContractRepository.create()`'s own stricter `Date | null`
          // input needs an explicit narrowing here rather than loosening
          // the repository's real contract to match Prisma's wider one.
        } as Parameters<typeof crmContractRepository.create>[0],
        tx,
      ),
    );
  }

  async function setVersionStatus(versionId: string, status: CrmProposalStatus, graph = platformGraph): Promise<void> {
    const lifecycle =
      status === "ACCEPTED"
        ? { acceptedAt: new Date(), acceptanceMechanism: "INTERNAL_RECORDED" as const }
        : status === "REJECTED"
          ? { rejectedAt: new Date() }
          : {};
    await withTenantContext(contextFor(graph), (tx) => tx.crmProposalVersion.update({ where: { id: versionId }, data: { status, ...lifecycle } }));
  }

  async function seedAcceptedOrigin(graph: ParentGraph) {
    const proposal = await seedProposal(graph);
    const version = await seedVersion(graph, proposal.id);
    await setVersionStatus(version.id, "SENT", graph);
    await setVersionStatus(version.id, "ACCEPTED", graph);
    return { proposalId: proposal.id, versionId: version.id };
  }

  describe("fail-closed baseline and tenant isolation", () => {
    it("shows zero rows from all five tables when no tenant context is set", async () => {
      const template = await seedTemplate(platformGraph);
      const proposal = await seedProposal(platformGraph, { templateId: template.id });
      const version = await seedVersion(platformGraph, proposal.id);
      await seedLineItem(platformGraph, version.id);
      await seedContract(platformGraph);

      const visible = await withTenantContext(NO_TENANT_CONTEXT, async (tx) => ({
        proposals: await tx.crmProposal.findMany(),
        versions: await tx.crmProposalVersion.findMany(),
        lineItems: await tx.crmProposalLineItem.findMany(),
        templates: await tx.crmProposalTemplate.findMany(),
        contracts: await tx.crmContract.findMany(),
      }));
      expect(visible).toEqual({ proposals: [], versions: [], lineItems: [], templates: [], contracts: [] });
    });

    it("isolates SELECT, UPDATE, and INSERT across organizations for all five tables", async () => {
      const templateA = await seedTemplate(platformGraph);
      const proposalA = await seedProposal(platformGraph, { templateId: templateA.id });
      const versionA = await seedVersion(platformGraph, proposalA.id);
      const lineA = await seedLineItem(platformGraph, versionA.id);
      const contractA = await seedContract(platformGraph);

      const templateB = await seedTemplate(customerGraph);
      const proposalB = await seedProposal(customerGraph, { templateId: templateB.id });
      const versionB = await seedVersion(customerGraph, proposalB.id);
      const lineB = await seedLineItem(customerGraph, versionB.id);
      const contractB = await seedContract(customerGraph);

      const ids = {
        proposal: [proposalA.id, proposalB.id],
        version: [versionA.id, versionB.id],
        line: [lineA.id, lineB.id],
        template: [templateA.id, templateB.id],
        contract: [contractA.id, contractB.id],
      };
      const seenA = await withTenantContext(platformContext(), async (tx) => ({
        proposal: (await tx.crmProposal.findMany({ where: { id: { in: ids.proposal } } })).map((row) => row.id),
        version: (await tx.crmProposalVersion.findMany({ where: { id: { in: ids.version } } })).map((row) => row.id),
        line: (await tx.crmProposalLineItem.findMany({ where: { id: { in: ids.line } } })).map((row) => row.id),
        template: (await tx.crmProposalTemplate.findMany({ where: { id: { in: ids.template } } })).map((row) => row.id),
        contract: (await tx.crmContract.findMany({ where: { id: { in: ids.contract } } })).map((row) => row.id),
      }));
      const seenB = await withTenantContext(customerPlatformContext(), async (tx) => ({
        proposal: (await tx.crmProposal.findMany({ where: { id: { in: ids.proposal } } })).map((row) => row.id),
        version: (await tx.crmProposalVersion.findMany({ where: { id: { in: ids.version } } })).map((row) => row.id),
        line: (await tx.crmProposalLineItem.findMany({ where: { id: { in: ids.line } } })).map((row) => row.id),
        template: (await tx.crmProposalTemplate.findMany({ where: { id: { in: ids.template } } })).map((row) => row.id),
        contract: (await tx.crmContract.findMany({ where: { id: { in: ids.contract } } })).map((row) => row.id),
      }));
      expect(seenA).toEqual({ proposal: [proposalA.id], version: [versionA.id], line: [lineA.id], template: [templateA.id], contract: [contractA.id] });
      expect(seenB).toEqual({ proposal: [proposalB.id], version: [versionB.id], line: [lineB.id], template: [templateB.id], contract: [contractB.id] });

      const nonPlatformSeen = await withTenantContext(customerContext(), (tx) => tx.crmProposal.findMany({ where: { id: { in: ids.proposal } } }));
      expect(nonPlatformSeen).toEqual([]);

      const mutationCounts = await withTenantContext(customerPlatformContext(), async (tx) => ({
        proposal: (await tx.crmProposal.updateMany({ where: { id: proposalA.id }, data: { assignedToUserId: null } })).count,
        version: (await tx.crmProposalVersion.updateMany({ where: { id: versionA.id }, data: { title: "Cross-tenant" } })).count,
        line: (await tx.crmProposalLineItem.updateMany({ where: { id: lineA.id }, data: { title: "Cross-tenant" } })).count,
        template: (await tx.crmProposalTemplate.updateMany({ where: { id: templateA.id }, data: { name: `Cross tenant ${generateId()}` } })).count,
        contract: (await tx.crmContract.updateMany({ where: { id: contractA.id }, data: { renewalTerms: "Cross-tenant" } })).count,
      }));
      expect(mutationCounts).toEqual({ proposal: 0, version: 0, line: 0, template: 0, contract: 0 });

      const forgedProposalId = generateId();
      const forgedVersionId = generateId();
      const forgedLineId = generateId();
      const forgedTemplateId = generateId();
      const forgedContractId = generateId();
      proposalIds.push(forgedProposalId);
      versionIds.push(forgedVersionId);
      lineItemIds.push(forgedLineId);
      templateIds.push(forgedTemplateId);
      contractIds.push(forgedContractId);
      await expect(withTenantContext(customerPlatformContext(), (tx) => tx.crmProposal.create({ data: { id: forgedProposalId, organizationId: platformOrgId, dealId: platformGraph.dealId, companyId: platformGraph.companyId, proposalNumber: `FORGED-${generateId()}` } }))).rejects.toThrow();
      await expect(withTenantContext(customerPlatformContext(), (tx) => tx.crmProposalVersion.create({ data: { ...versionData(platformGraph, proposalA.id), id: forgedVersionId } }))).rejects.toThrow();
      await expect(withTenantContext(customerPlatformContext(), (tx) => tx.crmProposalLineItem.create({ data: { ...lineItemData(platformGraph, versionA.id), id: forgedLineId } }))).rejects.toThrow();
      await expect(withTenantContext(customerPlatformContext(), (tx) => tx.crmProposalTemplate.create({ data: { id: forgedTemplateId, organizationId: platformOrgId, name: `Forged ${generateId()}`, defaultTitle: "Forged", defaultBodyHtml: "<p>Forged</p>" } }))).rejects.toThrow();
      await expect(withTenantContext(customerPlatformContext(), (tx) => tx.crmContract.create({ data: { id: forgedContractId, organizationId: platformOrgId, dealId: platformGraph.dealId, companyId: platformGraph.companyId, contractNumber: `FORGED-CON-${generateId()}`, createdByUserId: platformUserId } }))).rejects.toThrow();
    });
  });

  describe("relationship-integrity trigger", () => {
    it("rejects a proposal whose deal belongs to another organization", async () => {
      const id = generateId();
      proposalIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposal.create({ data: { id, organizationId: platformOrgId, dealId: customerGraph.dealId, companyId: customerGraph.companyId, proposalNumber: `PROP-${generateId()}` } })), "23514");
    });

    it("rejects a proposal whose company belongs to another organization", async () => {
      const id = generateId();
      proposalIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposal.create({ data: { id, organizationId: platformOrgId, dealId: platformGraph.dealId, companyId: customerGraph.companyId, proposalNumber: `PROP-${generateId()}` } })), "23514");
    });

    it("rejects a proposal whose primary contact belongs to another organization", async () => {
      const id = generateId();
      proposalIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposal.create({ data: { id, organizationId: platformOrgId, dealId: platformGraph.dealId, companyId: platformGraph.companyId, primaryContactId: customerGraph.contactId, proposalNumber: `PROP-${generateId()}` } })), "23514");
    });

    it("rejects a same-organization primary contact from a different company", async () => {
      const id = generateId();
      proposalIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposal.create({ data: { id, organizationId: platformOrgId, dealId: platformGraph.dealId, companyId: platformGraph.companyId, primaryContactId: platformGraph.otherCompanyContactId, proposalNumber: `PROP-${generateId()}` } })), "23514", "same organization and company");
    });

    it("rejects a proposal version whose proposal belongs to another organization", async () => {
      const foreignProposal = await seedProposal(customerGraph);
      await expectPgError(createRawVersion(platformGraph, foreignProposal.id, {}), "23514");
    });

    it("rejects a line item whose version belongs to another organization", async () => {
      const proposal = await seedProposal(customerGraph);
      const version = await seedVersion(customerGraph, proposal.id);
      await expectPgError(seedLineItem(platformGraph, version.id), "23514");
    });

    it("rejects a proposal whose template belongs to another organization", async () => {
      const template = await seedTemplate(customerGraph);
      const id = generateId();
      proposalIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposal.create({ data: { id, organizationId: platformOrgId, dealId: platformGraph.dealId, companyId: platformGraph.companyId, proposalNumber: `PROP-${generateId()}`, templateId: template.id } })), "23514");
    });

    it("rejects a contract whose deal belongs to another organization", async () => {
      await expectPgError(seedContract(platformGraph, null, { dealId: customerGraph.dealId, companyId: customerGraph.companyId }), "23514");
    });

    it("rejects a contract whose company belongs to another organization", async () => {
      await expectPgError(seedContract(platformGraph, null, { companyId: customerGraph.companyId }), "23514");
    });

    it("rejects a contract whose originating proposal belongs to another organization", async () => {
      const origin = await seedAcceptedOrigin(customerGraph);
      await expectPgError(seedContract(platformGraph, origin), "23514");
    });

    it("rejects a contract whose originating version belongs to another organization", async () => {
      const localProposal = await seedProposal(platformGraph);
      const foreignOrigin = await seedAcceptedOrigin(customerGraph);
      await expectPgError(seedContract(platformGraph, { proposalId: localProposal.id, versionId: foreignOrigin.versionId }), "23514");
    });

    it("rejects an originating version that does not belong to the stated proposal", async () => {
      const statedProposal = await seedProposal(platformGraph);
      const otherOrigin = await seedAcceptedOrigin(platformGraph);
      await expectPgError(seedContract(platformGraph, { proposalId: statedProposal.id, versionId: otherOrigin.versionId }), "23514");
    });

    it("rejects an originating version that is not ACCEPTED", async () => {
      const proposal = await seedProposal(platformGraph);
      const draftVersion = await seedVersion(platformGraph, proposal.id);
      await expectPgError(seedContract(platformGraph, { proposalId: proposal.id, versionId: draftVersion.id }), "23514");
    });
  });

  describe("line-item DRAFT policy", () => {
    it("allows line-item INSERT and UPDATE while the owning version is DRAFT", async () => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      const line = await seedLineItem(platformGraph, version.id);
      const result = await withTenantContext(platformContext(), (tx) => tx.crmProposalLineItem.updateMany({ where: { id: line.id }, data: { title: "Updated while draft" } }));
      expect(result.count).toBe(1);
    });

    it.each(["SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const)("blocks line-item INSERT and UPDATE when the owning version is %s", async (status) => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      const existing = await seedLineItem(platformGraph, version.id);
      if (status !== "SENT") await setVersionStatus(version.id, "SENT");
      await setVersionStatus(version.id, status);

      const update = await withTenantContext(platformContext(), (tx) => tx.crmProposalLineItem.updateMany({ where: { id: existing.id }, data: { title: `Changed after ${status}` } }));
      expect(update.count).toBe(0);
      await expect(seedLineItem(platformGraph, version.id)).rejects.toThrow();
    });
  });

  describe("proposal-version commercial-field immutability", () => {
    it("allows every commercial field to change while DRAFT, permits lifecycle acceptance after SENT, and rejects multiple commercial fields afterward", async () => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      const changedUntil = new Date("2028-06-30T00:00:00.000Z");
      const draftUpdate = await withTenantContext(platformContext(), (tx) =>
        tx.crmProposalVersion.update({
          where: { id: version.id },
          data: {
            title: "Changed title",
            bodyHtml: "<p>Changed body</p>",
            termsHtml: "<p>Changed terms</p>",
            currency: "EUR",
            subtotalMinorUnits: 20_000,
            discountType: "FIXED",
            discountValue: 2_000,
            discountedSubtotalMinorUnits: 18_000,
            taxAmountMinorUnits: 500,
            totalMinorUnits: 18_500,
            validUntil: changedUntil,
          },
        }),
      );
      expect(draftUpdate).toMatchObject({ title: "Changed title", currency: "EUR", totalMinorUnits: 18_500, validUntil: changedUntil });

      await setVersionStatus(version.id, "SENT");
      const acceptedAt = new Date();
      const accepted = await withTenantContext(platformContext(), (tx) =>
        tx.crmProposalVersion.update({
          where: { id: version.id },
          data: { status: "ACCEPTED", acceptedAt, acceptanceMechanism: "INTERNAL_RECORDED" },
        }),
      );
      expect(accepted).toMatchObject({ status: "ACCEPTED", acceptanceMechanism: "INTERNAL_RECORDED" });

      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposalVersion.update({ where: { id: version.id }, data: { title: "Forbidden title" } })), "23514", "immutable");
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.crmProposalVersion.update({ where: { id: version.id }, data: { totalMinorUnits: 18_501 } })), "23514", "immutable");
    });
  });

  describe("uniqueness and CHECK constraints", () => {
    it("rejects duplicate proposal numbers", async () => {
      const proposal = await seedProposal(platformGraph);
      await expect(seedProposal(platformGraph, { proposalNumber: proposal.proposalNumber })).rejects.toThrow();
    });

    it("rejects duplicate (proposal_id, version_number)", async () => {
      const proposal = await seedProposal(platformGraph);
      await seedVersion(platformGraph, proposal.id, 1);
      await expect(createRawVersion(platformGraph, proposal.id, { versionNumber: 1 })).rejects.toThrow();
    });

    it.each([
      ["negative subtotal", { subtotalMinorUnits: -1 }],
      ["negative discounted subtotal", { discountedSubtotalMinorUnits: -1 }],
      ["negative total", { totalMinorUnits: -1 }],
      ["discounted subtotal above subtotal", { subtotalMinorUnits: 100, discountedSubtotalMinorUnits: 101, totalMinorUnits: 101 }],
      ["discount value inconsistent with NONE", { discountType: "NONE", discountValue: 1 }],
      ["version number below one", { versionNumber: 0 }],
    ] as const)("rejects proposal-version CHECK violation: %s", async (_label, overrides) => {
      const proposal = await seedProposal(platformGraph);
      await expectPgError(createRawVersion(platformGraph, proposal.id, overrides as Partial<Prisma.CrmProposalVersionUncheckedCreateInput>), "23514");
    });

    it.each([
      ["negative line total", { lineTotalMinorUnits: -1 }],
      ["quantity below one", { quantity: 0 }],
      ["negative unit amount", { unitAmountMinorUnits: -1 }],
      ["discount value inconsistent with NONE", { discountType: "NONE", discountValue: 1 }],
    ] as const)("rejects line-item CHECK violation: %s", async (_label, overrides) => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      await expectPgError(seedLineItem(platformGraph, version.id, overrides as Partial<Prisma.CrmProposalLineItemUncheckedCreateInput>), "23514");
    });

    it("rejects duplicate contract numbers", async () => {
      const contract = await seedContract(platformGraph);
      await expect(seedContract(platformGraph, null, { contractNumber: contract.contractNumber })).rejects.toThrow();
    });

    it.each(["proposal-only", "version-only"] as const)("rejects an incomplete contract origin pair: %s", async (half) => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      const overrides = half === "proposal-only" ? { originatingProposalId: proposal.id } : { originatingProposalVersionId: version.id };
      await expectPgError(seedContract(platformGraph, null, overrides), "23514");
    });
  });

  describe("DELETE denial", () => {
    /**
     * `crm_proposal_line_items` is deliberately EXCLUDED from this blanket
     * denial — see the migration's own `tenant_isolation_delete` policy
     * comment. `crmProposalLineItemRepository.replaceForVersion()` (used
     * by every `createProposal()`/`updateProposalDraft()`/`reviseProposal()`
     * call) deletes a version's existing line items before recreating
     * them, so line items need a real, working DELETE path while their
     * owning version is still DRAFT. This was a genuine bug caught by
     * Codex's own Build 22 security review: the original migration
     * blanket-revoked DELETE on all five tables with no line-item
     * exception, which would have made every proposal create/edit fail
     * outright under the real restricted role. See its own dedicated
     * test below.
     */
    it("denies DELETE on the four top-level business-record tables even in the correct tenant context", async () => {
      const template = await seedTemplate(platformGraph);
      const proposal = await seedProposal(platformGraph, { templateId: template.id });
      const version = await seedVersion(platformGraph, proposal.id);
      const contract = await seedContract(platformGraph);

      const attempts = [
        withTenantContext(platformContext(), (tx) => tx.crmProposal.deleteMany({ where: { id: proposal.id } })),
        withTenantContext(platformContext(), (tx) => tx.crmProposalVersion.deleteMany({ where: { id: version.id } })),
        withTenantContext(platformContext(), (tx) => tx.crmProposalTemplate.deleteMany({ where: { id: template.id } })),
        withTenantContext(platformContext(), (tx) => tx.crmContract.deleteMany({ where: { id: contract.id } })),
      ];
      const outcomes = await Promise.all(attempts.map((attempt) => attempt.then((result) => ({ count: result.count })).catch((error) => ({ error }))));
      for (const outcome of outcomes) {
        if ("count" in outcome) expect(outcome.count).toBe(0);
        else expect(outcome.error).toBeDefined();
      }

      const remaining = await withTenantContext(platformContext(), async (tx) => ({
        proposal: await tx.crmProposal.findUnique({ where: { id: proposal.id } }),
        version: await tx.crmProposalVersion.findUnique({ where: { id: version.id } }),
        template: await tx.crmProposalTemplate.findUnique({ where: { id: template.id } }),
        contract: await tx.crmContract.findUnique({ where: { id: contract.id } }),
      }));
      for (const row of Object.values(remaining)) expect(row).not.toBeNull();
    });

    it("allows DELETE on a line item while its owning version is DRAFT, and denies it once the version leaves DRAFT", async () => {
      const proposal = await seedProposal(platformGraph);
      const draftVersion = await seedVersion(platformGraph, proposal.id, 1);
      const draftLine = await seedLineItem(platformGraph, draftVersion.id);

      const draftResult = await withTenantContext(platformContext(), (tx) => tx.crmProposalLineItem.deleteMany({ where: { id: draftLine.id } }));
      expect(draftResult.count).toBe(1);
      expect(await withTenantContext(platformContext(), (tx) => tx.crmProposalLineItem.findUnique({ where: { id: draftLine.id } }))).toBeNull();

      const sentVersion = await seedVersion(platformGraph, proposal.id, 2);
      const sentLine = await seedLineItem(platformGraph, sentVersion.id);
      await setVersionStatus(sentVersion.id, "SENT");

      const sentResult = await withTenantContext(platformContext(), (tx) => tx.crmProposalLineItem.deleteMany({ where: { id: sentLine.id } }));
      expect(sentResult.count).toBe(0);
      expect(await withTenantContext(platformContext(), (tx) => tx.crmProposalLineItem.findUnique({ where: { id: sentLine.id } }))).not.toBeNull();
    });
  });

  describe("numbering sequences", () => {
    it.each(["proposal_number_seq", "contract_number_seq"] as const)("returns ten distinct concurrent values from %s", async (sequence) => {
      const values = await Promise.all(
        Array.from({ length: 10 }, () =>
          withTenantContext(platformContext(), async (tx) => {
            const rows =
              sequence === "proposal_number_seq"
                ? await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('proposal_number_seq') AS value`
                : await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('contract_number_seq') AS value`;
            return rows[0]!.value.toString();
          }),
        ),
      );
      expect(new Set(values).size).toBe(10);
    });
  });

  describe("accepted-version CAS invariant", () => {
    it("allows exactly one of two concurrent SENT-to-ACCEPTED SQL updates", async () => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      await setVersionStatus(version.id, "SENT");

      const accept = () =>
        withTenantContext(platformContext(), (tx) =>
          tx.$executeRaw`
            UPDATE crm_proposal_versions
               SET status = 'ACCEPTED',
                   accepted_at = NOW(),
                   acceptance_mechanism = 'INTERNAL_RECORDED',
                   updated_at = NOW()
             WHERE id = ${version.id}::uuid
               AND status = 'SENT'
          `,
        );
      const counts = await Promise.all([accept(), accept()]);
      expect([...counts].sort()).toEqual([0, 1]);

      const stored = await withTenantContext(platformContext(), (tx) => tx.crmProposalVersion.findUnique({ where: { id: version.id } }));
      expect(stored).toMatchObject({ status: "ACCEPTED", acceptanceMechanism: "INTERNAL_RECORDED" });
    });
  });

  describe("reviseToNewVersion CAS invariant", () => {
    /**
     * Proves the fix for a real race Codex's own Build 22 security review
     * found: `reviseProposal()` previously wrote `currentVersionId` and
     * `status` as two independent, unconditional updates, so a concurrent
     * acceptProposal() committing ACCEPTED in between them was silently
     * overwritten back to DRAFT — reopening an accepted proposal. The fix
     * (`crmProposalRepository.reviseToNewVersion()`) is a single CAS
     * `updateMany()` guarded on the root's expected PRE-revise status.
     */
    it("rejects reviseToNewVersion when the root's status no longer matches expectedStatus (simulating a concurrent accept)", async () => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      await setVersionStatus(version.id, "SENT");
      await withTenantContext(platformContext(), (tx) => tx.crmProposal.update({ where: { id: proposal.id }, data: { status: "SENT" } }));

      // Simulate a concurrent acceptProposal() that already committed.
      await withTenantContext(platformContext(), (tx) => tx.crmProposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } }));

      const newVersion = await seedVersion(platformGraph, proposal.id, 2);
      const result = await withTenantContext(platformContext(), (tx) => crmProposalRepository.reviseToNewVersion(proposal.id, "SENT", newVersion.id, tx));
      expect(result).toBeNull();

      const stored = await withTenantContext(platformContext(), (tx) => tx.crmProposal.findUnique({ where: { id: proposal.id } }));
      expect(stored).toMatchObject({ status: "ACCEPTED", currentVersionId: null });
    });

    it("atomically advances both currentVersionId and status back to DRAFT when expectedStatus still matches", async () => {
      const proposal = await seedProposal(platformGraph);
      const version = await seedVersion(platformGraph, proposal.id);
      await setVersionStatus(version.id, "SENT");
      await withTenantContext(platformContext(), (tx) => tx.crmProposal.update({ where: { id: proposal.id }, data: { status: "SENT" } }));

      const newVersion = await seedVersion(platformGraph, proposal.id, 2);
      const result = await withTenantContext(platformContext(), (tx) => crmProposalRepository.reviseToNewVersion(proposal.id, "SENT", newVersion.id, tx));
      expect(result).toMatchObject({ status: "DRAFT", currentVersionId: newVersion.id });
    });
  });
});
