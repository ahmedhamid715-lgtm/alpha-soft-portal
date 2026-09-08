import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { crmClientOnboardingAssignmentRepository } from "@/server/repositories/crm-client-onboarding-assignment-repository";
import { crmClientOnboardingChecklistItemRepository } from "@/server/repositories/crm-client-onboarding-checklist-item-repository";
import { crmClientOnboardingDocumentRepository } from "@/server/repositories/crm-client-onboarding-document-repository";
import { crmClientOnboardingIntakeFieldRepository } from "@/server/repositories/crm-client-onboarding-intake-field-repository";
import { crmClientOnboardingIntakeResponseRepository } from "@/server/repositories/crm-client-onboarding-intake-response-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingRequirementRepository } from "@/server/repositories/crm-client-onboarding-requirement-repository";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmContractRepository } from "@/server/repositories/crm-contract-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";

type ParentGraph = {
  organizationId: string;
  userId: string;
  companyId: string;
  pipelineId: string;
  stageId: string;
  dealId: string;
  linkedOrganizationId: string;
  proposalId: string;
};

type AggregateRows = {
  onboardingId: string;
  serviceItemId: string;
  fieldId: string;
  responseId: string;
  requirementId: string;
  documentId: string;
  checklistItemId: string;
  assignmentId: string;
};

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

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

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Client Onboarding Row-Level Security (database integration)", () => {
  let platformOrgId: string;
  let customerOrgId: string;
  let platformUserId: string;
  let customerUserId: string;
  let platformGraph: ParentGraph;
  let customerGraph: ParentGraph;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const proposalIds: string[] = [];
  const contractIds: string[] = [];
  const onboardingIds: string[] = [];
  const intakeFieldIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });
  const customerContext = (): TenantContextInput => ({ userId: customerUserId, organizationId: customerOrgId, isPlatformStaff: false });
  const customerPlatformContext = (): TenantContextInput => ({ userId: customerUserId, organizationId: customerOrgId, isPlatformStaff: true });

  function contextForOrganization(organizationId: string): TenantContextInput {
    return organizationId === platformOrgId ? platformContext() : customerPlatformContext();
  }

  beforeEach(async () => {
    platformOrgId = await createOrganization("Client Onboarding RLS Org A");
    customerOrgId = await createOrganization("Client Onboarding RLS Org B");
    platformUserId = await createUser("client-onboarding-rls-a");
    customerUserId = await createUser("client-onboarding-rls-b");
    platformGraph = await seedParentGraph(platformOrgId, platformUserId, platformContext());
    customerGraph = await seedParentGraph(customerOrgId, customerUserId, customerPlatformContext());
  });

  afterEach(async () => {
    if (onboardingIds.length) await db.crmClientOnboarding.deleteMany({ where: { id: { in: onboardingIds } } });
    if (intakeFieldIds.length) await db.crmClientOnboardingIntakeField.deleteMany({ where: { id: { in: intakeFieldIds } } });
    if (contractIds.length) await db.crmContract.deleteMany({ where: { id: { in: contractIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });

    for (const ids of [onboardingIds, intakeFieldIds, contractIds, proposalIds, dealIds, stageIds, pipelineIds, companyIds, userIds, organizationIds]) {
      ids.length = 0;
    }
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `client-onboarding-${id}` });
    return id;
  }

  async function createUser(prefix: string): Promise<string> {
    const id = generateId();
    userIds.push(id);
    await userRepository.create({ id, email: `${prefix}-${id}@example.com`, name: `Client Onboarding Actor ${id}` });
    return id;
  }

  async function seedParentGraph(
    organizationId: string,
    userId: string,
    context: TenantContextInput,
    options: { convertCompany?: boolean; linkedOrganizationId?: string } = {},
  ): Promise<ParentGraph> {
    const companyId = generateId();
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const proposalId = generateId();
    const linkedOrganizationId = options.linkedOrganizationId ?? (await createOrganization(`Linked Customer ${companyId}`));
    companyIds.push(companyId);
    pipelineIds.push(pipelineId);
    stageIds.push(stageId);
    dealIds.push(dealId);
    proposalIds.push(proposalId);

    await withTenantContext(context, async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId, name: `Onboarding Company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      if (options.convertCompany !== false) {
        const linked = await crmCompanyRepository.linkToOrganization(companyId, linkedOrganizationId, tx);
        expect(linked?.convertedToOrganizationId).toBe(linkedOrganizationId);
      }
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId, name: `Onboarding Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({
        data: { id: dealId, organizationId, pipelineId, stageId, companyId, title: `Onboarding Deal ${dealId}`, status: "WON", wonAt: new Date(), assignedToUserId: userId },
      });
      await crmProposalRepository.create(
        {
          id: proposalId,
          organizationId,
          dealId,
          companyId,
          primaryContactId: null,
          proposalNumber: `ONBOARD-${generateId()}`,
          templateId: null,
          assignedToUserId: userId,
        },
        tx,
      );
    });

    return { organizationId, userId, companyId, pipelineId, stageId, dealId, linkedOrganizationId, proposalId };
  }

  async function seedAdditionalGraph(organizationId = platformOrgId, userId = platformUserId): Promise<ParentGraph> {
    return seedParentGraph(organizationId, userId, contextForOrganization(organizationId));
  }

  function onboardingData(graph: ParentGraph, overrides: Partial<Prisma.CrmClientOnboardingUncheckedCreateInput> = {}): Prisma.CrmClientOnboardingUncheckedCreateInput {
    return {
      id: generateId(),
      organizationId: graph.organizationId,
      dealId: graph.dealId,
      companyId: graph.companyId,
      linkedOrganizationId: graph.linkedOrganizationId,
      originatingProposalId: graph.proposalId,
      originatingContractId: null,
      createdByUserId: graph.userId,
      ...overrides,
    };
  }

  async function createRawOnboarding(
    graph: ParentGraph,
    overrides: Partial<Prisma.CrmClientOnboardingUncheckedCreateInput> = {},
    context = contextForOrganization(graph.organizationId),
  ) {
    const data = onboardingData(graph, overrides);
    onboardingIds.push(data.id);
    return withTenantContext(context, (tx) => tx.crmClientOnboarding.create({ data }));
  }

  async function seedOnboarding(graph: ParentGraph) {
    const id = generateId();
    onboardingIds.push(id);
    return withTenantContext(contextForOrganization(graph.organizationId), (tx) =>
      crmClientOnboardingRepository.create(
        {
          id,
          organizationId: graph.organizationId,
          dealId: graph.dealId,
          companyId: graph.companyId,
          linkedOrganizationId: graph.linkedOrganizationId,
          originatingContractId: null,
          originatingProposalId: graph.proposalId,
          createdByUserId: graph.userId,
        },
        tx,
      ),
    );
  }

  async function seedContract(graph: ParentGraph) {
    const id = generateId();
    contractIds.push(id);
    return withTenantContext(contextForOrganization(graph.organizationId), (tx) =>
      crmContractRepository.create(
        {
          id,
          organizationId: graph.organizationId,
          dealId: graph.dealId,
          companyId: graph.companyId,
          originatingProposalId: null,
          originatingProposalVersionId: null,
          contractNumber: `ONBOARD-CON-${generateId()}`,
          effectiveDate: null,
          endDate: null,
          renewalTerms: null,
          createdByUserId: graph.userId,
        },
        tx,
      ),
    );
  }

  async function seedAggregate(graph: ParentGraph): Promise<AggregateRows> {
    const onboarding = await seedOnboarding(graph);
    const fieldId = generateId();
    const requirementId = generateId();
    const documentId = generateId();
    const checklistItemId = generateId();
    intakeFieldIds.push(fieldId);

    return withTenantContext(contextForOrganization(graph.organizationId), async (tx) => {
      await crmClientOnboardingServiceItemRepository.createMany(
        onboarding.id,
        graph.organizationId,
        [{ title: "Implementation", description: null, quantity: 1, sourceLineItemId: null, onboardingRequired: true, notes: null }],
        tx,
      );
      const serviceItem = await tx.crmClientOnboardingServiceItem.findFirstOrThrow({ where: { onboardingId: onboarding.id } });
      const field = await crmClientOnboardingIntakeFieldRepository.create(
        { id: fieldId, organizationId: graph.organizationId, label: `Contact email ${fieldId}`, fieldType: "EMAIL", required: true, options: null, sortOrder: 0 },
        tx,
      );
      const response = await crmClientOnboardingIntakeResponseRepository.upsert(
        { organizationId: graph.organizationId, onboardingId: onboarding.id, fieldId: field.id, value: "client@example.com", respondedByUserId: graph.userId },
        tx,
      );
      const requirement = await crmClientOnboardingRequirementRepository.create(
        { id: requirementId, organizationId: graph.organizationId, onboardingId: onboarding.id, title: "Provide access", description: null, required: true, responsibleUserId: graph.userId, dueDate: null, sortOrder: 0 },
        tx,
      );
      const document = await crmClientOnboardingDocumentRepository.create(
        { id: documentId, organizationId: graph.organizationId, onboardingId: onboarding.id, title: "Signed brief", description: null },
        tx,
      );
      const checklistItem = await crmClientOnboardingChecklistItemRepository.create(
        { id: checklistItemId, organizationId: graph.organizationId, onboardingId: onboarding.id, title: "Schedule kickoff", description: null, required: true, assignedToUserId: graph.userId, dueDate: null, sortOrder: 0 },
        tx,
      );
      const assignment = await crmClientOnboardingAssignmentRepository.upsert(
        { organizationId: graph.organizationId, onboardingId: onboarding.id, role: "ONBOARDING_OWNER", userId: graph.userId, assignedByUserId: graph.userId },
        tx,
      );
      return {
        onboardingId: onboarding.id,
        serviceItemId: serviceItem.id,
        fieldId: field.id,
        responseId: response.id,
        requirementId: requirement.id,
        documentId: document.id,
        checklistItemId: checklistItem.id,
        assignmentId: assignment.id,
      };
    });
  }

  describe("fail-closed baseline and tenant isolation", () => {
    it("shows zero rows from all eight tables when no tenant context is set", async () => {
      await seedAggregate(platformGraph);
      const visible = await withTenantContext(NO_TENANT_CONTEXT, async (tx) => ({
        onboardings: await tx.crmClientOnboarding.findMany(),
        serviceItems: await tx.crmClientOnboardingServiceItem.findMany(),
        intakeFields: await tx.crmClientOnboardingIntakeField.findMany(),
        intakeResponses: await tx.crmClientOnboardingIntakeResponse.findMany(),
        requirements: await tx.crmClientOnboardingRequirement.findMany(),
        documents: await tx.crmClientOnboardingDocument.findMany(),
        checklistItems: await tx.crmClientOnboardingChecklistItem.findMany(),
        assignments: await tx.crmClientOnboardingAssignment.findMany(),
      }));
      expect(visible).toEqual({ onboardings: [], serviceItems: [], intakeFields: [], intakeResponses: [], requirements: [], documents: [], checklistItems: [], assignments: [] });
    });

    it("isolates SELECT, UPDATE, and INSERT across organizations for all eight tables", async () => {
      const rowsA = await seedAggregate(platformGraph);
      const rowsB = await seedAggregate(customerGraph);

      async function visibleIds(context: TenantContextInput) {
        return withTenantContext(context, async (tx) => ({
          onboarding: (await tx.crmClientOnboarding.findMany({ where: { id: { in: [rowsA.onboardingId, rowsB.onboardingId] } } })).map((row) => row.id),
          serviceItem: (await tx.crmClientOnboardingServiceItem.findMany({ where: { id: { in: [rowsA.serviceItemId, rowsB.serviceItemId] } } })).map((row) => row.id),
          field: (await tx.crmClientOnboardingIntakeField.findMany({ where: { id: { in: [rowsA.fieldId, rowsB.fieldId] } } })).map((row) => row.id),
          response: (await tx.crmClientOnboardingIntakeResponse.findMany({ where: { id: { in: [rowsA.responseId, rowsB.responseId] } } })).map((row) => row.id),
          requirement: (await tx.crmClientOnboardingRequirement.findMany({ where: { id: { in: [rowsA.requirementId, rowsB.requirementId] } } })).map((row) => row.id),
          document: (await tx.crmClientOnboardingDocument.findMany({ where: { id: { in: [rowsA.documentId, rowsB.documentId] } } })).map((row) => row.id),
          checklist: (await tx.crmClientOnboardingChecklistItem.findMany({ where: { id: { in: [rowsA.checklistItemId, rowsB.checklistItemId] } } })).map((row) => row.id),
          assignment: (await tx.crmClientOnboardingAssignment.findMany({ where: { id: { in: [rowsA.assignmentId, rowsB.assignmentId] } } })).map((row) => row.id),
        }));
      }

      expect(await visibleIds(platformContext())).toEqual({
        onboarding: [rowsA.onboardingId], serviceItem: [rowsA.serviceItemId], field: [rowsA.fieldId], response: [rowsA.responseId], requirement: [rowsA.requirementId], document: [rowsA.documentId], checklist: [rowsA.checklistItemId], assignment: [rowsA.assignmentId],
      });
      expect(await visibleIds(customerPlatformContext())).toEqual({
        onboarding: [rowsB.onboardingId], serviceItem: [rowsB.serviceItemId], field: [rowsB.fieldId], response: [rowsB.responseId], requirement: [rowsB.requirementId], document: [rowsB.documentId], checklist: [rowsB.checklistItemId], assignment: [rowsB.assignmentId],
      });
      expect(await withTenantContext(customerContext(), (tx) => tx.crmClientOnboarding.findMany())).toEqual([]);

      const updates = await withTenantContext(customerPlatformContext(), async (tx) => ({
        onboarding: (await tx.crmClientOnboarding.updateMany({ where: { id: rowsA.onboardingId }, data: { kickoffNotes: "forged" } })).count,
        serviceItem: (await tx.crmClientOnboardingServiceItem.updateMany({ where: { id: rowsA.serviceItemId }, data: { notes: "forged" } })).count,
        field: (await tx.crmClientOnboardingIntakeField.updateMany({ where: { id: rowsA.fieldId }, data: { label: `Forged ${generateId()}` } })).count,
        response: (await tx.crmClientOnboardingIntakeResponse.updateMany({ where: { id: rowsA.responseId }, data: { value: "forged" } })).count,
        requirement: (await tx.crmClientOnboardingRequirement.updateMany({ where: { id: rowsA.requirementId }, data: { title: "forged" } })).count,
        document: (await tx.crmClientOnboardingDocument.updateMany({ where: { id: rowsA.documentId }, data: { title: "forged" } })).count,
        checklist: (await tx.crmClientOnboardingChecklistItem.updateMany({ where: { id: rowsA.checklistItemId }, data: { title: "forged" } })).count,
        assignment: (await tx.crmClientOnboardingAssignment.updateMany({ where: { id: rowsA.assignmentId }, data: { role: "SERVICE_LEAD" } })).count,
      }));
      expect(updates).toEqual({ onboarding: 0, serviceItem: 0, field: 0, response: 0, requirement: 0, document: 0, checklist: 0, assignment: 0 });

      const forgedOnboarding = onboardingData(platformGraph);
      onboardingIds.push(forgedOnboarding.id);
      const forgedFieldId = generateId();
      intakeFieldIds.push(forgedFieldId);
      // `Promise.allSettled()`, not a plain array + sequential `await
      // expect(...).rejects` — these 8 promises all start running (and
      // some reject) concurrently the instant this array literal is
      // evaluated, before the later `for` loop gets around to attaching
      // its own per-promise handler; Node's own unhandled-rejection
      // detector flags the ones that reject before being individually
      // awaited, even though every assertion below still genuinely
      // passes. `allSettled` observes all 8 up front, eliminating the
      // (harmless, but noisy) warning.
      const settled = await Promise.allSettled([
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboarding.create({ data: forgedOnboarding })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingServiceItem.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: rowsA.onboardingId, title: "Forged" } })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingIntakeField.create({ data: { id: forgedFieldId, organizationId: platformOrgId, label: `Forged ${forgedFieldId}`, fieldType: "SHORT_TEXT" } })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingIntakeResponse.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: rowsA.onboardingId, fieldId: rowsA.fieldId } })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingRequirement.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: rowsA.onboardingId, title: "Forged" } })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingDocument.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: rowsA.onboardingId, title: "Forged" } })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingChecklistItem.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: rowsA.onboardingId, title: "Forged" } })),
        withTenantContext(customerPlatformContext(), (tx) => tx.crmClientOnboardingAssignment.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: rowsA.onboardingId, userId: platformUserId, role: "SERVICE_LEAD", assignedByUserId: platformUserId } })),
      ]);
      for (const outcome of settled) expect(outcome.status).toBe("rejected");
    });
  });

  describe("relationship-integrity trigger", () => {
    it("rejects an onboarding whose deal belongs to another organization", async () => {
      await expectPgError(createRawOnboarding(platformGraph, { dealId: customerGraph.dealId, companyId: customerGraph.companyId }), "23514", "same organization and company");
    });

    it("rejects an onboarding whose deal's company differs from its company", async () => {
      const other = await seedAdditionalGraph();
      await expectPgError(createRawOnboarding(platformGraph, { companyId: other.companyId, linkedOrganizationId: other.linkedOrganizationId }), "23514", "same organization and company");
    });

    it("rejects an onboarding whose company belongs to another organization", async () => {
      await expectPgError(createRawOnboarding(platformGraph, { companyId: customerGraph.companyId, linkedOrganizationId: customerGraph.linkedOrganizationId }), "23514");
    });

    it("rejects a linked organization that differs from the company's converted organization", async () => {
      const otherLinkedOrganizationId = await createOrganization("Wrong linked customer");
      await expectPgError(createRawOnboarding(platformGraph, { linkedOrganizationId: otherLinkedOrganizationId }), "23514", "must match the company converted organization");
    });

    it("rejects a linked organization when the company has never been converted", async () => {
      const graph = await seedParentGraph(platformOrgId, platformUserId, platformContext(), { convertCompany: false });
      await expectPgError(createRawOnboarding(graph), "23514", "conversion must exist");
    });

    it("rejects a linked organization marked as the platform organization", async () => {
      const platformLinkedId = (await db.organization.findFirstOrThrow({ where: { isPlatform: true }, select: { id: true } })).id;
      const graph = await seedParentGraph(platformOrgId, platformUserId, platformContext(), { linkedOrganizationId: platformLinkedId });
      await expectPgError(createRawOnboarding(graph), "23514", "must not be the platform organization");
    });

    it("rejects an originating contract from another organization", async () => {
      const contract = await seedContract(customerGraph);
      await expectPgError(createRawOnboarding(platformGraph, { originatingContractId: contract.id, originatingProposalId: null }), "23514", "same organization and deal");
    });

    it("rejects an originating contract from another deal in the same organization", async () => {
      const other = await seedAdditionalGraph();
      const contract = await seedContract(other);
      await expectPgError(createRawOnboarding(platformGraph, { originatingContractId: contract.id, originatingProposalId: null }), "23514", "same organization and deal");
    });

    it("rejects an originating proposal from another organization", async () => {
      await expectPgError(createRawOnboarding(platformGraph, { originatingProposalId: customerGraph.proposalId }), "23514", "same organization and deal");
    });

    it("rejects an originating proposal from another deal in the same organization", async () => {
      const other = await seedAdditionalGraph();
      await expectPgError(createRawOnboarding(platformGraph, { originatingProposalId: other.proposalId }), "23514", "same organization and deal");
    });

    it.each(["serviceItem", "requirement", "document", "checklistItem", "assignment"] as const)(
      "rejects a %s whose onboarding belongs to another organization",
      async (kind) => {
        const foreignOnboarding = await seedOnboarding(customerGraph);
        // `Promise.resolve(...)` around each branch — Prisma's own
        // `.create()` returns a lazy, model-specific fluent/thenable type,
        // not a plain `Promise`, so a union of 5 different models' own
        // return types across these branches doesn't unify into a single
        // `Promise<T>` shape TS can reconcile against `withTenantContext()`'s
        // own generic signature without this normalization.
        const promise = withTenantContext(platformContext(), async (tx): Promise<unknown> => {
          if (kind === "serviceItem") return tx.crmClientOnboardingServiceItem.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: foreignOnboarding.id, title: "Forged" } });
          if (kind === "requirement") return tx.crmClientOnboardingRequirement.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: foreignOnboarding.id, title: "Forged" } });
          if (kind === "document") return tx.crmClientOnboardingDocument.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: foreignOnboarding.id, title: "Forged" } });
          if (kind === "checklistItem") return tx.crmClientOnboardingChecklistItem.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: foreignOnboarding.id, title: "Forged" } });
          return tx.crmClientOnboardingAssignment.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: foreignOnboarding.id, userId: platformUserId, role: "SERVICE_LEAD", assignedByUserId: platformUserId } });
        });
        await expectPgError(promise, "23514", "same organization");
      },
    );

    it("rejects a requirement linked to a document from another onboarding in the same organization", async () => {
      const first = await seedAggregate(platformGraph);
      const other = await seedAdditionalGraph();
      const second = await seedAggregate(other);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingRequirement.update({ where: { id: first.requirementId }, data: { documentId: second.documentId } })),
        "23514",
        "same organization and onboarding",
      );
    });

    it("rejects an intake response whose onboarding belongs to another organization", async () => {
      const foreignOnboarding = await seedOnboarding(customerGraph);
      const fieldId = generateId();
      intakeFieldIds.push(fieldId);
      await withTenantContext(platformContext(), (tx) => crmClientOnboardingIntakeFieldRepository.create({ id: fieldId, organizationId: platformOrgId, label: `Local field ${fieldId}`, fieldType: "SHORT_TEXT", required: true, options: null, sortOrder: 0 }, tx));
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeResponse.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: foreignOnboarding.id, fieldId } })),
        "23514",
        "onboarding must belong to the same organization",
      );
    });

    it("rejects an intake response whose field belongs to another organization", async () => {
      const localOnboarding = await seedOnboarding(platformGraph);
      const foreignFieldId = generateId();
      intakeFieldIds.push(foreignFieldId);
      await withTenantContext(customerPlatformContext(), (tx) => crmClientOnboardingIntakeFieldRepository.create({ id: foreignFieldId, organizationId: customerOrgId, label: `Foreign field ${foreignFieldId}`, fieldType: "SHORT_TEXT", required: true, options: null, sortOrder: 0 }, tx));
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeResponse.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: localOnboarding.id, fieldId: foreignFieldId } })),
        "23514",
        "field must belong to the same organization",
      );
    });
  });

  describe("CHECK constraints", () => {
    it("requires at least one origin while accepting contract-only, proposal-only, and both", async () => {
      await expectPgError(createRawOnboarding(platformGraph, { originatingContractId: null, originatingProposalId: null }), "23514");

      const contractOnlyGraph = await seedAdditionalGraph();
      const contractOnly = await seedContract(contractOnlyGraph);
      await expect(createRawOnboarding(contractOnlyGraph, { originatingContractId: contractOnly.id, originatingProposalId: null })).resolves.toBeDefined();

      const proposalOnlyGraph = await seedAdditionalGraph();
      await expect(createRawOnboarding(proposalOnlyGraph)).resolves.toBeDefined();

      const bothGraph = await seedAdditionalGraph();
      const bothContract = await seedContract(bothGraph);
      await expect(createRawOnboarding(bothGraph, { originatingContractId: bothContract.id, originatingProposalId: bothGraph.proposalId })).resolves.toBeDefined();
    });

    it("rejects completion_override without a reason", async () => {
      await expectPgError(createRawOnboarding(platformGraph, { completionOverride: true, completionOverrideReason: null }), "23514");
    });

    it("rejects a service-item quantity below one", async () => {
      const onboarding = await seedOnboarding(platformGraph);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingServiceItem.create({ data: { id: generateId(), organizationId: platformOrgId, onboardingId: onboarding.id, title: "Invalid quantity", quantity: 0 } })),
        "23514",
      );
    });

    it("rejects options on non-SELECT fields and permits null or populated SELECT options", async () => {
      const invalidId = generateId();
      const nullSelectId = generateId();
      const populatedSelectId = generateId();
      intakeFieldIds.push(invalidId, nullSelectId, populatedSelectId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeField.create({ data: { id: invalidId, organizationId: platformOrgId, label: `Invalid ${invalidId}`, fieldType: "SHORT_TEXT", options: ["not allowed"] } })),
        "23514",
      );
      await expect(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeField.create({ data: { id: nullSelectId, organizationId: platformOrgId, label: `Null select ${nullSelectId}`, fieldType: "SELECT" } })),
      ).resolves.toBeDefined();
      await expect(
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeField.create({ data: { id: populatedSelectId, organizationId: platformOrgId, label: `Populated select ${populatedSelectId}`, fieldType: "SELECT", options: ["A", "B"] } })),
      ).resolves.toBeDefined();
    });
  });

  describe("company conversion idempotency", () => {
    it("enforces uniqueness for non-null converted organization ids", async () => {
      const graph = await seedAdditionalGraph();
      const secondCompanyId = generateId();
      companyIds.push(secondCompanyId);
      await withTenantContext(platformContext(), (tx) => crmCompanyRepository.create({ id: secondCompanyId, organizationId: platformOrgId, name: `Second company ${secondCompanyId}`, domain: null, industry: null, website: null, phone: null }, tx));
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.crmCompany.update({ where: { id: secondCompanyId }, data: { convertedToOrganizationId: graph.linkedOrganizationId } })),
        undefined,
        "unique",
      );
    });

    it("allows multiple companies to remain unconverted with NULL conversion ids", async () => {
      const ids = [generateId(), generateId(), generateId()];
      companyIds.push(...ids);
      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmCompany.createMany({ data: ids.map((id) => ({ id, organizationId: platformOrgId, name: `Never converted ${id}`, convertedToOrganizationId: null })) }),
        ),
      ).resolves.toMatchObject({ count: 3 });
    });

    it("allows exactly one of two concurrent SQL conversion CAS updates", async () => {
      const companyId = generateId();
      companyIds.push(companyId);
      const firstLinkedId = await createOrganization("CAS linked customer one");
      const secondLinkedId = await createOrganization("CAS linked customer two");
      await withTenantContext(platformContext(), (tx) => crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `CAS company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx));

      const convert = (linkedOrganizationId: string) =>
        withTenantContext(platformContext(), (tx) =>
          tx.$executeRaw`
            UPDATE crm_companies
               SET converted_to_organization_id = ${linkedOrganizationId}::uuid,
                   updated_at = NOW()
             WHERE id = ${companyId}::uuid
               AND converted_to_organization_id IS NULL
          `,
        );
      const counts = await Promise.all([convert(firstLinkedId), convert(secondLinkedId)]);
      expect([...counts].sort()).toEqual([0, 1]);

      const stored = await withTenantContext(platformContext(), (tx) => tx.crmCompany.findUnique({ where: { id: companyId } }));
      expect([firstLinkedId, secondLinkedId]).toContain(stored?.convertedToOrganizationId);
    });
  });

  describe("one active onboarding per deal", () => {
    it.each(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const)("rejects a second %s onboarding for a deal with an active onboarding", async (status) => {
      await seedOnboarding(platformGraph);
      await expect(createRawOnboarding(platformGraph, { status })).rejects.toThrow();
    });

    it("allows a new onboarding when the deal's only existing onboarding is CANCELLED", async () => {
      const historical = await seedOnboarding(platformGraph);
      const updated = await withTenantContext(platformContext(), (tx) =>
        tx.$executeRaw`
          UPDATE crm_client_onboardings
             SET status = 'CANCELLED',
                 cancelled_at = NOW(),
                 cancelled_reason = 'Fixture cancellation',
                 cancelled_by_user_id = ${platformUserId}::uuid,
                 updated_at = NOW()
           WHERE id = ${historical.id}::uuid
        `,
      );
      expect(updated).toBe(1);
      await expect(createRawOnboarding(platformGraph)).resolves.toBeDefined();
    });
  });

  describe("DELETE denial and response upsert", () => {
    it("denies DELETE on all eight tables in the correct tenant context", async () => {
      const rows = await seedAggregate(platformGraph);
      const attempts = [
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboarding.deleteMany({ where: { id: rows.onboardingId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingServiceItem.deleteMany({ where: { id: rows.serviceItemId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeField.deleteMany({ where: { id: rows.fieldId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeResponse.deleteMany({ where: { id: rows.responseId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingRequirement.deleteMany({ where: { id: rows.requirementId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingDocument.deleteMany({ where: { id: rows.documentId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingChecklistItem.deleteMany({ where: { id: rows.checklistItemId } })),
        withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingAssignment.deleteMany({ where: { id: rows.assignmentId } })),
      ];
      const outcomes = await Promise.all(attempts.map((attempt) => attempt.then((result) => ({ count: result.count })).catch((error) => ({ error }))));
      for (const outcome of outcomes) {
        if ("count" in outcome) expect(outcome.count).toBe(0);
        else expect(outcome.error).toBeDefined();
      }

      const remaining = await withTenantContext(platformContext(), async (tx) => Promise.all([
        tx.crmClientOnboarding.findUnique({ where: { id: rows.onboardingId } }),
        tx.crmClientOnboardingServiceItem.findUnique({ where: { id: rows.serviceItemId } }),
        tx.crmClientOnboardingIntakeField.findUnique({ where: { id: rows.fieldId } }),
        tx.crmClientOnboardingIntakeResponse.findUnique({ where: { id: rows.responseId } }),
        tx.crmClientOnboardingRequirement.findUnique({ where: { id: rows.requirementId } }),
        tx.crmClientOnboardingDocument.findUnique({ where: { id: rows.documentId } }),
        tx.crmClientOnboardingChecklistItem.findUnique({ where: { id: rows.checklistItemId } }),
        tx.crmClientOnboardingAssignment.findUnique({ where: { id: rows.assignmentId } }),
      ]));
      for (const row of remaining) expect(row).not.toBeNull();
    });

    it("allows the restricted role to update an owned intake response through upsert", async () => {
      const rows = await seedAggregate(platformGraph);
      const updated = await withTenantContext(platformContext(), (tx) =>
        crmClientOnboardingIntakeResponseRepository.upsert(
          { organizationId: platformOrgId, onboardingId: rows.onboardingId, fieldId: rows.fieldId, value: "corrected@example.com", respondedByUserId: platformUserId },
          tx,
        ),
      );
      expect(updated).toMatchObject({ id: rows.responseId, value: "corrected@example.com" });
      expect(await withTenantContext(platformContext(), (tx) => tx.crmClientOnboardingIntakeResponse.count({ where: { onboardingId: rows.onboardingId, fieldId: rows.fieldId } }))).toBe(1);
    });
  });
});
