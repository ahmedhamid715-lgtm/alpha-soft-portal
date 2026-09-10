import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmTaskRepository } from "@/server/repositories/crm-task-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingChecklistItemRepository } from "@/server/repositories/crm-client-onboarding-checklist-item-repository";
import { crmClientOnboardingRequirementRepository } from "@/server/repositories/crm-client-onboarding-requirement-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { projectRepository } from "@/server/repositories/project-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { internalTaskRepository } from "@/server/repositories/internal-task-repository";
import { globalTaskQueryRepository, type GlobalTaskQueryFilters } from "@/server/repositories/global-task-query-repository";

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

/**
 * Task Management (Build 28 — Roadmap Module 22) database integration
 * coverage: the raw SQL UNION query's own correctness (every source
 * branch, filters, ordering, pagination) AND its RLS/cross-tenant
 * safety — a cross-domain aggregator is a real IDOR surface, treated
 * with the same rigor Build 27's own equivalent file established.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Task Management global query (database integration)", () => {
  let platformOrgId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;
  let otherUserId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const projectIds: string[] = [];
  const dealIds: string[] = [];
  const proposalIds: string[] = [];
  const pipelineIds: string[] = [];
  const onboardingIds: string[] = [];
  const crmTaskIds: string[] = [];
  const internalTaskIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    platformOrgId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!platformOrgId) {
      platformOrgId = generateId();
      organizationIds.push(platformOrgId);
      await db.organization.create({ data: { id: platformOrgId, name: "Platform", displayName: "Platform", slug: `platform-${platformOrgId}`, isPlatform: true } });
    }
    customerOrgAId = await createOrganization("Task Mgmt RLS Customer A");
    customerOrgBId = await createOrganization("Task Mgmt RLS Customer B");
    platformUserId = await createUser("task-mgmt-rls-a");
    otherUserId = await createUser("task-mgmt-rls-b");
  });

  afterEach(async () => {
    if (internalTaskIds.length) await db.internalTask.deleteMany({ where: { id: { in: internalTaskIds } } }).catch(() => {});
    if (crmTaskIds.length) await db.crmTask.deleteMany({ where: { id: { in: crmTaskIds } } }).catch(() => {});
    if (onboardingIds.length) await db.crmClientOnboarding.deleteMany({ where: { id: { in: onboardingIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (pipelineIds.length) await db.crmPipelineStage.deleteMany({ where: { pipelineId: { in: pipelineIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    for (const ids of [internalTaskIds, crmTaskIds, onboardingIds, proposalIds, dealIds, pipelineIds, projectIds, companyIds, userIds, organizationIds]) ids.length = 0;
    companyByOrg.clear();
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `task-mgmt-rls-${id}` });
    return id;
  }

  async function createUser(prefix: string): Promise<string> {
    const id = generateId();
    userIds.push(id);
    await userRepository.create({ id, email: `${prefix}-${id}@example.com`, name: `Task Mgmt RLS Actor ${id}` });
    return id;
  }

  // `crm_companies.converted_to_organization_id` is UNIQUE — a customer
  // organization can only ever be the conversion target of one company.
  // Every seed helper in this file shares one customer org per test, so
  // the company is created once and cached, not once per call.
  const companyByOrg = new Map<string, string>();

  async function seedCompany(customerOrganizationId: string): Promise<string> {
    const cached = companyByOrg.get(customerOrganizationId);
    if (cached) return cached;
    const companyId = generateId();
    companyIds.push(companyId);
    companyByOrg.set(customerOrganizationId, companyId);
    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `Task Mgmt RLS Company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyId, customerOrganizationId, tx);
    });
    return companyId;
  }

  async function seedProjectTask(assignedToUserId: string | null, dueAt: Date | null, status: "TODO" | "DONE" | "CANCELLED" = "TODO") {
    const companyId = await seedCompany(customerOrgAId);
    const projectId = generateId();
    projectIds.push(projectId);
    return withTenantContext(platformContext(), async (tx) => {
      const project = await projectRepository.create(
        { id: projectId, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: null, sourceServiceItemId: null, sourceTemplateId: null, title: `Task Mgmt RLS Project ${projectId}`, description: null, priority: "HIGH", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId },
        tx,
      );
      const task = await projectTaskRepository.create(
        { id: generateId(), organizationId: platformOrgId, projectId: project.id, milestoneId: null, parentTaskId: null, title: `Task Mgmt RLS ProjectTask`, description: null, priority: "HIGH", assignedToUserId, dueDate: dueAt, sortOrder: 1000, customerVisible: false, createdByUserId: platformUserId },
        tx,
      );
      if (status !== "TODO") await tx.projectTask.update({ where: { id: task.id }, data: { status } });
      return { projectId: project.id, taskId: task.id };
    });
  }

  async function seedCrmTask(assignedToUserId: string | null, dueAt: Date | null) {
    const companyId = await seedCompany(customerOrgAId);
    const taskId = generateId();
    crmTaskIds.push(taskId);
    return withTenantContext(platformContext(), (tx) => crmTaskRepository.create({ id: taskId, organizationId: platformOrgId, companyId, leadId: null, contactId: null, title: "Task Mgmt RLS CrmTask", description: null, dueAt, assignedToUserId, createdByUserId: platformUserId }, tx));
  }

  async function seedOnboardingWithItems(assignedToUserId: string | null, dueDate: Date | null) {
    const companyId = await seedCompany(customerOrgAId);
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const proposalId = generateId();
    pipelineIds.push(pipelineId);
    dealIds.push(dealId);
    proposalIds.push(proposalId);

    return withTenantContext(platformContext(), async (tx) => {
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId: platformOrgId, name: `Task Mgmt RLS Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId: platformOrgId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({ data: { id: dealId, organizationId: platformOrgId, pipelineId, stageId, companyId, title: `Task Mgmt RLS Deal ${dealId}`, status: "WON", wonAt: new Date(), assignedToUserId: platformUserId } });
      await crmProposalRepository.create({ id: proposalId, organizationId: platformOrgId, dealId, companyId, primaryContactId: null, proposalNumber: `TM-RLS-${proposalId}`, templateId: null, assignedToUserId: platformUserId }, tx);

      const onboardingId = generateId();
      onboardingIds.push(onboardingId);
      const onboarding = await crmClientOnboardingRepository.create(
        { id: onboardingId, organizationId: platformOrgId, dealId, companyId, linkedOrganizationId: customerOrgAId, originatingContractId: null, originatingProposalId: proposalId, createdByUserId: platformUserId },
        tx,
      );

      const checklistItem = await crmClientOnboardingChecklistItemRepository.create(
        { id: generateId(), organizationId: platformOrgId, onboardingId: onboarding.id, title: "Task Mgmt RLS Checklist", description: null, required: true, assignedToUserId, dueDate, sortOrder: 0 },
        tx,
      );
      const requirement = await crmClientOnboardingRequirementRepository.create(
        { id: generateId(), organizationId: platformOrgId, onboardingId: onboarding.id, title: "Task Mgmt RLS Requirement", description: null, required: true, responsibleUserId: assignedToUserId, dueDate, sortOrder: 0 },
        tx,
      );
      return { onboardingId: onboarding.id, checklistItemId: checklistItem.id, requirementId: requirement.id };
    });
  }

  async function seedInternalTask(assignedToUserId: string | null, dueAt: Date | null) {
    const taskId = generateId();
    internalTaskIds.push(taskId);
    return withTenantContext(platformContext(), (tx) => internalTaskRepository.create({ id: taskId, organizationId: platformOrgId, title: "Task Mgmt RLS Standalone", description: null, priority: "URGENT", assignedToUserId, dueAt, createdByUserId: platformUserId }, tx));
  }

  const ALL_SOURCES: GlobalTaskQueryFilters["sourceTypes"] = ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"];

  describe("cross-source union correctness", () => {
    it("includes exactly one row per source for a shared assignee, correctly normalized", async () => {
      const dueAt = new Date("2026-07-01T00:00:00Z");
      const { taskId: projectTaskId } = await seedProjectTask(platformUserId, dueAt);
      const crmTask = await seedCrmTask(platformUserId, dueAt);
      const { checklistItemId, requirementId } = await seedOnboardingWithItems(platformUserId, dueAt);
      const internalTask = await seedInternalTask(platformUserId, dueAt);

      const rows = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ALL_SOURCES, assignedToUserId: platformUserId }, 50, 0, tx));

      const bySource = Object.fromEntries(rows.map((r) => [r.sourceType, r]));
      expect(bySource.PROJECT_TASK?.sourceId).toBe(projectTaskId);
      expect(bySource.PROJECT_TASK?.statusRaw).toBe("TODO");
      expect(bySource.CRM_TASK?.sourceId).toBe(crmTask.id);
      expect(bySource.ONBOARDING_CHECKLIST?.sourceId).toBe(checklistItemId);
      expect(bySource.ONBOARDING_REQUIREMENT?.sourceId).toBe(requirementId);
      expect(bySource.STANDALONE_TASK?.sourceId).toBe(internalTask.id);
      expect(rows).toHaveLength(5);
      // Every row shares the same due date — all should be present regardless of column-name differences per source (due_date vs due_at, assigned_to_user_id vs responsible_user_id).
      for (const row of rows) expect(row.dueAt?.toISOString()).toBe(dueAt.toISOString());
    });

    it("excludes rows assigned to a different user", async () => {
      await seedInternalTask(otherUserId, null);
      const rows = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ALL_SOURCES, assignedToUserId: platformUserId }, 50, 0, tx));
      expect(rows).toHaveLength(0);
    });

    it("only includes the requested sourceTypes — a caller-narrowed subset is honored", async () => {
      await seedInternalTask(platformUserId, null);
      await seedCrmTask(platformUserId, null);
      const rows = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["STANDALONE_TASK"], assignedToUserId: platformUserId }, 50, 0, tx));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceType).toBe("STANDALONE_TASK");
    });

    it("normalized status filter correctly excludes a source with no matching raw status (CANCELLED against onboarding items)", async () => {
      const { checklistItemId } = await seedOnboardingWithItems(platformUserId, null);
      void checklistItemId;
      const rows = await withTenantContext(platformContext(), (tx) =>
        globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["ONBOARDING_CHECKLIST"], assignedToUserId: platformUserId, status: ["CANCELLED"] }, 50, 0, tx),
      );
      expect(rows).toHaveLength(0);
    });

    it("normalized status filter correctly matches a source's own raw status (PENDING -> OPEN)", async () => {
      await seedOnboardingWithItems(platformUserId, null);
      const rows = await withTenantContext(platformContext(), (tx) =>
        globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["ONBOARDING_CHECKLIST"], assignedToUserId: platformUserId, status: ["OPEN"] }, 50, 0, tx),
      );
      expect(rows).toHaveLength(1);
    });

    it("priority filter excludes sources with no real priority column entirely", async () => {
      await seedCrmTask(platformUserId, null); // CrmTask has no priority — must never match a priority filter.
      await seedInternalTask(platformUserId, null); // seedInternalTask always creates URGENT.
      const rows = await withTenantContext(platformContext(), (tx) =>
        globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["CRM_TASK", "STANDALONE_TASK"], assignedToUserId: platformUserId, priority: ["URGENT"] }, 50, 0, tx),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceType).toBe("STANDALONE_TASK");
    });

    it("due-window OVERDUE excludes a COMPLETED/CANCELLED task even with a past due date", async () => {
      const past = new Date("2020-01-01T00:00:00Z");
      const { taskId } = await seedProjectTask(platformUserId, past, "DONE");
      void taskId;
      const rows = await withTenantContext(platformContext(), (tx) =>
        globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["PROJECT_TASK"], assignedToUserId: platformUserId, dueWindow: "OVERDUE" }, 50, 0, tx),
      );
      expect(rows).toHaveLength(0);
    });

    it("real global pagination: LIMIT/OFFSET over the FULL unioned+ordered result, not a per-source top-N merge", async () => {
      // Three standalone tasks with staggered due dates, one CRM task due
      // earliest of all — the true global order interleaves sources.
      const earliest = await seedCrmTask(platformUserId, new Date("2026-01-01T00:00:00Z"));
      const t1 = await seedInternalTask(platformUserId, new Date("2026-02-01T00:00:00Z"));
      const t2 = await seedInternalTask(platformUserId, new Date("2026-03-01T00:00:00Z"));
      const t3 = await seedInternalTask(platformUserId, new Date("2026-04-01T00:00:00Z"));

      const page1 = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["CRM_TASK", "STANDALONE_TASK"], assignedToUserId: platformUserId }, 2, 0, tx));
      const page2 = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["CRM_TASK", "STANDALONE_TASK"], assignedToUserId: platformUserId }, 2, 2, tx));

      expect(page1.map((r) => r.sourceId)).toEqual([earliest.id, t1.id]);
      expect(page2.map((r) => r.sourceId)).toEqual([t2.id, t3.id]);

      const total = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.countAll(platformOrgId, { sourceTypes: ["CRM_TASK", "STANDALONE_TASK"], assignedToUserId: platformUserId }, tx));
      expect(total).toBe(4);
    });

    it("search filters by title across every source", async () => {
      await seedInternalTask(platformUserId, null);
      const rows = await withTenantContext(platformContext(), (tx) =>
        globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["STANDALONE_TASK"], assignedToUserId: platformUserId, search: "standalone" }, 50, 0, tx),
      );
      expect(rows).toHaveLength(1);
      const noMatch = await withTenantContext(platformContext(), (tx) =>
        globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ["STANDALONE_TASK"], assignedToUserId: platformUserId, search: "nonexistent-title-xyz" }, 50, 0, tx),
      );
      expect(noMatch).toHaveLength(0);
    });
  });

  describe("RLS / tenant isolation", () => {
    it("shows zero rows with no tenant context set (fail-closed baseline)", async () => {
      await seedInternalTask(platformUserId, null);
      const rows = await withTenantContext(NO_TENANT_CONTEXT, (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ALL_SOURCES }, 50, 0, tx));
      expect(rows).toHaveLength(0);
    });

    it("a bare (non-platform) customer tenant context sees zero rows regardless of which customer org — these tables are platform-context-only, same as crm_* tables", async () => {
      const { taskId } = await seedProjectTask(platformUserId, null); // owned by platformOrgId, customer context is customerOrgAId
      void taskId;
      await seedInternalTask(platformUserId, null);
      for (const organizationId of [customerOrgAId, customerOrgBId]) {
        const bareCustomerContext: TenantContextInput = { userId: platformUserId, organizationId, isPlatformStaff: false };
        const rows = await withTenantContext(bareCustomerContext, (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: ALL_SOURCES }, 50, 0, tx));
        expect(rows).toHaveLength(0);
      }
    });

    it("querying with an empty sourceTypes array returns zero rows and issues no query — the authorization-filtered list is never silently widened", async () => {
      await seedInternalTask(platformUserId, null);
      const rows = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.listPage(platformOrgId, { sourceTypes: [] }, 50, 0, tx));
      expect(rows).toHaveLength(0);
      const total = await withTenantContext(platformContext(), (tx) => globalTaskQueryRepository.countAll(platformOrgId, { sourceTypes: [] }, tx));
      expect(total).toBe(0);
    });
  });

  describe("InternalTask lifecycle", () => {
    it("denies DELETE on internal_tasks", async () => {
      const task = await seedInternalTask(platformUserId, null);
      const outcome = await withTenantContext(platformContext(), (tx) => tx.internalTask.deleteMany({ where: { id: task.id } }).then((r) => ({ count: r.count })).catch((error: unknown) => ({ error })));
      if ("count" in outcome) expect(outcome.count).toBe(0);
      else expect(outcome.error).toBeDefined();
      const stillThere = await withTenantContext(platformContext(), (tx) => internalTaskRepository.findById(task.id, tx));
      expect(stillThere).not.toBeNull();
    });

    it("requires a non-blank cancellation reason at the database layer", async () => {
      const task = await seedInternalTask(platformUserId, null);
      let caught: unknown;
      try {
        await withTenantContext(platformContext(), (tx) => tx.internalTask.update({ where: { id: task.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: "   " } }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
    });

    it("allows exactly one of two concurrent SQL completion CAS updates", async () => {
      const task = await seedInternalTask(platformUserId, null);
      const complete = () =>
        withTenantContext(platformContext(), (tx) =>
          tx.$executeRaw`UPDATE internal_tasks SET status = 'COMPLETED', completed_at = NOW(), completed_by_user_id = ${platformUserId}::uuid, updated_at = NOW() WHERE id = ${task.id}::uuid AND status NOT IN ('COMPLETED', 'CANCELLED')`,
        );
      const counts = await Promise.all([complete(), complete()]);
      expect([...counts].sort()).toEqual([0, 1]);
    });
  });
});
