import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Sales Pipeline Row-Level Security (database integration)", () => {
  let customerOrgId: string;
  let platformOrgId: string;
  let actorUserId: string;
  const pipelineIds: string[] = [];
  const stageIds: string[] = [];
  const dealIds: string[] = [];
  const historyIds: string[] = [];
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  const leadIds: string[] = [];

  const platformContext = () => ({ userId: actorUserId, organizationId: platformOrgId, isPlatformStaff: true });
  const customerContext = () => ({ userId: null, organizationId: customerOrgId, isPlatformStaff: false });

  beforeEach(async () => {
    customerOrgId = generateId();
    await organizationRepository.create({
      id: customerOrgId,
      name: "Sales Pipeline RLS Customer Org",
      displayName: "Sales Pipeline RLS Customer Org",
      slug: `sales-pipeline-rls-customer-${customerOrgId}`,
    });

    platformOrgId = (await organizationRepository.findPlatformOrganization())!.id;
    actorUserId = (await db.organizationMembership.findFirst({
      where: { organizationId: platformOrgId, status: "ACTIVE" },
      select: { userId: true },
    }))!.userId;
  });

  afterEach(async () => {
    // Scoped, never a blanket deleteMany({}) — test files run concurrently
    // against the same real database. Delete children before their parents.
    if (historyIds.length) await db.crmDealHistory.deleteMany({ where: { id: { in: historyIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (stageIds.length) await db.crmPipelineStage.deleteMany({ where: { id: { in: stageIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (contactIds.length) await db.crmContact.deleteMany({ where: { id: { in: contactIds } } });
    if (leadIds.length) await db.crmLead.deleteMany({ where: { id: { in: leadIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    await db.organization.delete({ where: { id: customerOrgId } });

    pipelineIds.length = 0;
    stageIds.length = 0;
    dealIds.length = 0;
    historyIds.length = 0;
    companyIds.length = 0;
    contactIds.length = 0;
    leadIds.length = 0;
  });

  async function seedPipeline(options: { isDefault?: boolean; name?: string } = {}) {
    const pipeline = await withTenantContext(platformContext(), (tx) =>
      tx.crmPipeline.create({
        data: {
          id: generateId(),
          organizationId: platformOrgId,
          name: options.name ?? `Sales Pipeline RLS ${generateId()}`,
          isDefault: options.isDefault ?? false,
        },
      }),
    );
    pipelineIds.push(pipeline.id);
    return pipeline;
  }

  async function seedStage(pipelineId: string, name = `Sales Pipeline RLS Stage ${generateId()}`) {
    const stage = await withTenantContext(platformContext(), (tx) =>
      tx.crmPipelineStage.create({
        data: { id: generateId(), organizationId: platformOrgId, pipelineId, name },
      }),
    );
    stageIds.push(stage.id);
    return stage;
  }

  async function seedCompany(name = "Sales Pipeline RLS Company") {
    const company = await withTenantContext(platformContext(), (tx) =>
      tx.crmCompany.create({ data: { id: generateId(), organizationId: platformOrgId, name } }),
    );
    companyIds.push(company.id);
    return company;
  }

  async function seedContact(companyId: string) {
    const contact = await withTenantContext(platformContext(), (tx) =>
      tx.crmContact.create({
        data: { id: generateId(), organizationId: platformOrgId, companyId, firstName: "Pipeline", lastName: "Contact" },
      }),
    );
    contactIds.push(contact.id);
    return contact;
  }

  async function seedLead(companyId: string) {
    const lead = await withTenantContext(platformContext(), (tx) =>
      tx.crmLead.create({
        data: { id: generateId(), organizationId: platformOrgId, companyId, title: "Sales Pipeline RLS Lead" },
      }),
    );
    leadIds.push(lead.id);
    return lead;
  }

  async function seedDeal(
    pipelineId: string,
    stageId: string,
    companyId: string,
    options: { primaryContactId?: string; sourceLeadId?: string; title?: string } = {},
  ) {
    const deal = await withTenantContext(platformContext(), (tx) =>
      tx.crmDeal.create({
        data: {
          id: generateId(),
          organizationId: platformOrgId,
          pipelineId,
          stageId,
          companyId,
          primaryContactId: options.primaryContactId,
          sourceLeadId: options.sourceLeadId,
          title: options.title ?? "Sales Pipeline RLS Deal",
        },
      }),
    );
    dealIds.push(deal.id);
    return deal;
  }

  async function seedDealWithParents() {
    const pipeline = await seedPipeline();
    const stage = await seedStage(pipeline.id);
    const company = await seedCompany();
    return seedDeal(pipeline.id, stage.id, company.id);
  }

  async function seedHistory(dealId: string) {
    const history = await withTenantContext(platformContext(), (tx) =>
      tx.crmDealHistory.create({
        data: {
          id: generateId(),
          organizationId: platformOrgId,
          dealId,
          type: "NOTE",
          note: "Sales Pipeline RLS history",
          actorUserId,
        },
      }),
    );
    historyIds.push(history.id);
    return history;
  }

  describe("crm_pipelines (direct ownership)", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seedPipeline();
      const seen = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
        tx.crmPipeline.findMany({}),
      );
      expect(seen).toEqual([]);
    });

    it("the customer organization cannot SELECT a platform-owned pipeline", async () => {
      const pipeline = await seedPipeline();
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmPipeline.findUnique({ where: { id: pipeline.id } }));
      expect(seen).toBeNull();
    });

    it("a zero-WHERE findMany() under the customer context never returns a platform-owned pipeline", async () => {
      await seedPipeline();
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmPipeline.findMany({}));
      expect(seen.every((pipeline) => pipeline.organizationId !== platformOrgId)).toBe(true);
    });

    it("a forged cross-tenant INSERT is rejected by WITH CHECK", async () => {
      const forgedId = generateId();
      pipelineIds.push(forgedId);

      await expect(
        withTenantContext(customerContext(), (tx) =>
          tx.crmPipeline.create({
            data: { id: forgedId, organizationId: platformOrgId, name: `Forged Pipeline ${generateId()}` },
          }),
        ),
      ).rejects.toThrow();
    });

    it("a legitimate INSERT under the platform context succeeds", async () => {
      const pipeline = await seedPipeline();
      expect(pipeline.organizationId).toBe(platformOrgId);
    });

    it("the customer organization cannot UPDATE a platform-owned pipeline", async () => {
      const pipeline = await seedPipeline();
      const result = await withTenantContext(customerContext(), (tx) =>
        tx.crmPipeline.updateMany({ where: { id: pipeline.id }, data: { name: "Forged pipeline update" } }),
      );
      expect(result.count).toBe(0);
      expect((await db.crmPipeline.findUnique({ where: { id: pipeline.id } }))?.name).toBe(pipeline.name);
    });

    it("DELETE is refused outright even for the platform context", async () => {
      const pipeline = await seedPipeline();
      await expect(withTenantContext(platformContext(), (tx) => tx.crmPipeline.delete({ where: { id: pipeline.id } }))).rejects.toThrow();
    });
  });

  describe("other directly-owned sales-pipeline tables", () => {
    it("crm_pipeline_stages is not visible to the customer organization", async () => {
      const stage = await seedStage((await seedPipeline()).id);
      expect(await withTenantContext(customerContext(), (tx) => tx.crmPipelineStage.findUnique({ where: { id: stage.id } }))).toBeNull();
    });

    it("crm_deals is not visible to the customer organization", async () => {
      const deal = await seedDealWithParents();
      expect(await withTenantContext(customerContext(), (tx) => tx.crmDeal.findUnique({ where: { id: deal.id } }))).toBeNull();
    });
  });

  describe("crm_deal_history (direct ownership, immutable)", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seedHistory((await seedDealWithParents()).id);
      const seen = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) =>
        tx.crmDealHistory.findMany({}),
      );
      expect(seen).toEqual([]);
    });

    it("the customer organization cannot SELECT platform-owned deal history", async () => {
      const history = await seedHistory((await seedDealWithParents()).id);
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmDealHistory.findUnique({ where: { id: history.id } }));
      expect(seen).toBeNull();
    });

    it("a zero-WHERE findMany() under the customer context never returns platform-owned deal history", async () => {
      await seedHistory((await seedDealWithParents()).id);
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmDealHistory.findMany({}));
      expect(seen.every((history) => history.organizationId !== platformOrgId)).toBe(true);
    });

    it("a legitimate INSERT under the platform context succeeds", async () => {
      const history = await seedHistory((await seedDealWithParents()).id);
      expect(history.organizationId).toBe(platformOrgId);
      expect(history.actorUserId).toBe(actorUserId);
    });

    it("UPDATE is refused outright even for the platform context", async () => {
      const history = await seedHistory((await seedDealWithParents()).id);
      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmDealHistory.update({ where: { id: history.id }, data: { note: "Cannot edit" } }),
        ),
      ).rejects.toThrow();
    });

    it("DELETE is refused outright for the platform context", async () => {
      const history = await seedHistory((await seedDealWithParents()).id);
      await expect(withTenantContext(platformContext(), (tx) => tx.crmDealHistory.delete({ where: { id: history.id } }))).rejects.toThrow();
    });
  });

  describe("database constraints", () => {
    it("rejects a second default pipeline for the same organization", async () => {
      const existingDefault = await withTenantContext(platformContext(), (tx) =>
        tx.crmPipeline.findFirst({ where: { isDefault: true } }),
      );
      expect(existingDefault?.organizationId).toBe(platformOrgId);

      const secondId = generateId();
      pipelineIds.push(secondId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmPipeline.create({
            data: {
              id: secondId,
              organizationId: platformOrgId,
              name: `Second Default Pipeline ${generateId()}`,
              isDefault: true,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a deal with negative value_minor_units", async () => {
      const pipeline = await seedPipeline();
      const stage = await seedStage(pipeline.id);
      const company = await seedCompany();
      const rejectedId = generateId();
      dealIds.push(rejectedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmDeal.create({
            data: {
              id: rejectedId,
              organizationId: platformOrgId,
              pipelineId: pipeline.id,
              stageId: stage.id,
              companyId: company.id,
              title: "Negative Value Deal",
              valueMinorUnits: -1,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a deal with probability above 100", async () => {
      const pipeline = await seedPipeline();
      const stage = await seedStage(pipeline.id);
      const company = await seedCompany();
      const rejectedId = generateId();
      dealIds.push(rejectedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmDeal.create({
            data: {
              id: rejectedId,
              organizationId: platformOrgId,
              pipelineId: pipeline.id,
              stageId: stage.id,
              companyId: company.id,
              title: "Invalid Probability Deal",
              probability: 101,
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("nested sales-pipeline relationship integrity", () => {
    it("rejects a deal whose stage belongs to a different pipeline", async () => {
      const pipelineA = await seedPipeline();
      const pipelineB = await seedPipeline();
      await seedStage(pipelineA.id);
      const stageB = await seedStage(pipelineB.id);
      const company = await seedCompany();
      const rejectedId = generateId();
      dealIds.push(rejectedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmDeal.create({
            data: {
              id: rejectedId,
              organizationId: platformOrgId,
              pipelineId: pipelineA.id,
              stageId: stageB.id,
              companyId: company.id,
              title: "Cross-Pipeline Stage Deal",
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a deal whose primary contact belongs to a different company", async () => {
      const pipeline = await seedPipeline();
      const stage = await seedStage(pipeline.id);
      const companyA = await seedCompany("Sales Pipeline RLS Company A");
      const companyB = await seedCompany("Sales Pipeline RLS Company B");
      const contactB = await seedContact(companyB.id);
      const rejectedId = generateId();
      dealIds.push(rejectedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmDeal.create({
            data: {
              id: rejectedId,
              organizationId: platformOrgId,
              pipelineId: pipeline.id,
              stageId: stage.id,
              companyId: companyA.id,
              primaryContactId: contactB.id,
              title: "Wrong-Company Contact Deal",
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a deal whose source lead belongs to a different company", async () => {
      const pipeline = await seedPipeline();
      const stage = await seedStage(pipeline.id);
      const companyA = await seedCompany("Sales Pipeline RLS Company A");
      const companyB = await seedCompany("Sales Pipeline RLS Company B");
      const leadB = await seedLead(companyB.id);
      const rejectedId = generateId();
      dealIds.push(rejectedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmDeal.create({
            data: {
              id: rejectedId,
              organizationId: platformOrgId,
              pipelineId: pipeline.id,
              stageId: stage.id,
              companyId: companyA.id,
              sourceLeadId: leadB.id,
              title: "Wrong-Company Source Lead Deal",
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("allows a legitimate deal with matching pipeline, stage, company, contact, and lead", async () => {
      const pipeline = await seedPipeline();
      const stage = await seedStage(pipeline.id);
      const company = await seedCompany();
      const contact = await seedContact(company.id);
      const lead = await seedLead(company.id);
      const deal = await seedDeal(pipeline.id, stage.id, company.id, {
        primaryContactId: contact.id,
        sourceLeadId: lead.id,
        title: "Valid Relationship Deal",
      });

      expect(deal.organizationId).toBe(platformOrgId);
      expect(deal.pipelineId).toBe(pipeline.id);
      expect(deal.stageId).toBe(stage.id);
      expect(deal.companyId).toBe(company.id);
      expect(deal.primaryContactId).toBe(contact.id);
      expect(deal.sourceLeadId).toBe(lead.id);
    });
  });
});
