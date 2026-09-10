import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { projectRepository } from "@/server/repositories/project-repository";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectTaskDependencyRepository } from "@/server/repositories/project-task-dependency-repository";
import { projectCommentRepository } from "@/server/repositories/project-comment-repository";
import { projectAttachmentRepository } from "@/server/repositories/project-attachment-repository";
import { projectApprovalRepository } from "@/server/repositories/project-approval-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { projectTemplateRepository, projectTemplateMilestoneRepository, projectTemplateTaskRepository } from "@/server/repositories/project-template-repository";
import { wouldCreateCycle } from "@/lib/projects/dependency-graph";

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

async function expectPgError(promise: Promise<unknown>, messageFragment?: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the database operation to be rejected").toBeDefined();
  if (messageFragment) expect(errorDiagnostic(caught).toLowerCase()).toContain(messageFragment.toLowerCase());
}

/**
 * RLS + relationship-integrity + idempotency + concurrency coverage for
 * every Build 27 (Project Management) table — the same discipline
 * `client-onboarding-rls.test.ts` (Build 23) establishes for its own
 * domain. See project-management.md "RLS" / "Security" / "Concurrency" /
 * "Idempotency" for the full design each assertion here verifies.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Project Management Row-Level Security (database integration)", () => {
  let platformOrgId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const projectIds: string[] = [];
  const templateIds: string[] = [];
  const dealIds: string[] = [];
  const pipelineIds: string[] = [];
  const proposalIds: string[] = [];
  const onboardingIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    platformOrgId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!platformOrgId) {
      platformOrgId = generateId();
      organizationIds.push(platformOrgId);
      await db.organization.create({ data: { id: platformOrgId, name: "Platform", displayName: "Platform", slug: `platform-${platformOrgId}`, isPlatform: true } });
    }
    customerOrgAId = await createOrganization("Project Mgmt RLS Customer A");
    customerOrgBId = await createOrganization("Project Mgmt RLS Customer B");
    platformUserId = await createUser("project-mgmt-rls");
  });

  afterEach(async () => {
    if (onboardingIds.length) await db.crmClientOnboarding.deleteMany({ where: { id: { in: onboardingIds } } });
    if (proposalIds.length) await db.crmProposal.deleteMany({ where: { id: { in: proposalIds } } });
    if (dealIds.length) await db.crmDeal.deleteMany({ where: { id: { in: dealIds } } });
    if (pipelineIds.length) await db.crmPipelineStage.deleteMany({ where: { pipelineId: { in: pipelineIds } } });
    if (pipelineIds.length) await db.crmPipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    if (projectIds.length) await db.project.deleteMany({ where: { id: { in: projectIds } } });
    if (templateIds.length) await db.projectTemplate.deleteMany({ where: { id: { in: templateIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    for (const ids of [onboardingIds, proposalIds, dealIds, pipelineIds, projectIds, templateIds, companyIds, userIds, organizationIds]) ids.length = 0;
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `pm-rls-${id}` });
    return id;
  }

  async function createUser(prefix: string): Promise<string> {
    const id = generateId();
    userIds.push(id);
    await userRepository.create({ id, email: `${prefix}-${id}@example.com`, name: `PM RLS Actor ${id}` });
    return id;
  }

  /** A converted `CrmCompany` for a given customer organization — every Project needs one. */
  async function seedCompany(customerOrganizationId: string): Promise<string> {
    const companyId = generateId();
    companyIds.push(companyId);
    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `PM RLS Company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      const linked = await crmCompanyRepository.linkToOrganization(companyId, customerOrganizationId, tx);
      expect(linked?.convertedToOrganizationId).toBe(customerOrganizationId);
    });
    return companyId;
  }

  async function seedProject(customerOrganizationId: string, companyId: string) {
    const id = generateId();
    projectIds.push(id);
    return withTenantContext(platformContext(), (tx) =>
      projectRepository.create(
        { id, organizationId: platformOrgId, customerOrganizationId, companyId, originatingOnboardingId: null, sourceServiceItemId: null, sourceTemplateId: null, title: `PM RLS Project ${id}`, description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId },
        tx,
      ),
    );
  }

  /** Full graph: company -> project -> milestone -> root task -> subtask, all for the SAME customer org. */
  async function seedFullGraph(customerOrganizationId: string) {
    const companyId = await seedCompany(customerOrganizationId);
    const project = await seedProject(customerOrganizationId, companyId);
    const milestone = await withTenantContext(platformContext(), (tx) =>
      milestoneRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: project.id, title: "Milestone", description: null, sortOrder: 1000, targetDate: null, customerVisible: false, createdByUserId: platformUserId }, tx),
    );
    const rootTask = await withTenantContext(platformContext(), (tx) =>
      projectTaskRepository.create(
        { id: generateId(), organizationId: platformOrgId, projectId: project.id, milestoneId: milestone.id, parentTaskId: null, title: "Root task", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 1000, customerVisible: false, createdByUserId: platformUserId },
        tx,
      ),
    );
    const subtask = await withTenantContext(platformContext(), (tx) =>
      projectTaskRepository.create(
        { id: generateId(), organizationId: platformOrgId, projectId: project.id, milestoneId: null, parentTaskId: rootTask.id, title: "Subtask", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 1000, customerVisible: false, createdByUserId: platformUserId },
        tx,
      ),
    );
    return { companyId, project, milestone, rootTask, subtask };
  }

  /** Full commercial chain a `CrmClientOnboarding` requires (deal WON -> accepted proposal) — only used by the onboarding-consistency / idempotency tests below. */
  async function seedOnboarding(customerOrganizationId: string, companyId: string, status: "IN_PROGRESS" | "COMPLETED" = "COMPLETED") {
    const pipelineId = generateId();
    const stageId = generateId();
    const dealId = generateId();
    const proposalId = generateId();
    pipelineIds.push(pipelineId);
    dealIds.push(dealId);
    proposalIds.push(proposalId);

    return withTenantContext(platformContext(), async (tx) => {
      await tx.crmPipeline.create({ data: { id: pipelineId, organizationId: platformOrgId, name: `PM RLS Pipeline ${pipelineId}` } });
      await tx.crmPipelineStage.create({ data: { id: stageId, organizationId: platformOrgId, pipelineId, name: "Won", sortOrder: 1000 } });
      await tx.crmDeal.create({ data: { id: dealId, organizationId: platformOrgId, pipelineId, stageId, companyId, title: `PM RLS Deal ${dealId}`, status: "WON", wonAt: new Date(), assignedToUserId: platformUserId } });
      await crmProposalRepository.create({ id: proposalId, organizationId: platformOrgId, dealId, companyId, primaryContactId: null, proposalNumber: `PM-RLS-${proposalId}`, templateId: null, assignedToUserId: platformUserId }, tx);

      const onboardingId = generateId();
      onboardingIds.push(onboardingId);
      const onboarding = await crmClientOnboardingRepository.create(
        { id: onboardingId, organizationId: platformOrgId, dealId, companyId, linkedOrganizationId: customerOrganizationId, originatingContractId: null, originatingProposalId: proposalId, createdByUserId: platformUserId, status },
        tx,
      );
      await crmClientOnboardingServiceItemRepository.createMany(onboardingId, platformOrgId, [{ title: "Service", description: null, quantity: 1, sourceLineItemId: null, onboardingRequired: true, notes: null }], tx);
      const serviceItem = await tx.crmClientOnboardingServiceItem.findFirstOrThrow({ where: { onboardingId } });
      return { onboarding, serviceItemId: serviceItem.id };
    });
  }

  describe("fail-closed baseline and tenant isolation", () => {
    it("shows zero rows from all 12 tables when no tenant context is set", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      await withTenantContext(platformContext(), (tx) => projectApprovalRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, resourceType: "PROJECT", resourceId: graph.project.id, requestedByUserId: platformUserId, visibility: "INTERNAL" }, tx));
      await withTenantContext(platformContext(), (tx) => projectQaCheckRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: null, milestoneId: null, title: "QA", required: true }, tx));
      await withTenantContext(platformContext(), (tx) => projectCommentRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: null, authorUserId: platformUserId, body: "hi", visibility: "INTERNAL" }, tx));
      await withTenantContext(platformContext(), (tx) => projectAttachmentRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: null, title: "File", description: null, externalUrl: null, visibility: "INTERNAL", uploadedByUserId: platformUserId }, tx));
      const templateId = generateId();
      templateIds.push(templateId);
      await withTenantContext(platformContext(), (tx) => projectTemplateRepository.create({ id: templateId, organizationId: platformOrgId, name: `Template ${templateId}`, description: null, createdByUserId: platformUserId }, tx));

      const visible = await withTenantContext(NO_TENANT_CONTEXT, async (tx) => ({
        projects: await tx.project.findMany(),
        milestones: await tx.milestone.findMany(),
        tasks: await tx.projectTask.findMany(),
        comments: await tx.projectComment.findMany(),
        attachments: await tx.projectAttachment.findMany(),
        approvals: await tx.projectApproval.findMany(),
        qaChecks: await tx.projectQaCheck.findMany(),
        templates: await tx.projectTemplate.findMany(),
      }));
      expect(visible).toEqual({ projects: [], milestones: [], tasks: [], comments: [], attachments: [], approvals: [], qaChecks: [], templates: [] });
    });

    it("isolates SELECT and blocks cross-organization UPDATE/forged INSERT for Project/Milestone/ProjectTask", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);

      // Every customer organization's own Project rows are owned by the
      // SAME platform organization (see project-repository.ts's own doc
      // comment) — the real tenant boundary here isn't a second platform
      // org, it's `tenant_is_platform_context()`: a non-platform (bare
      // customer) tenant context sees NOTHING, regardless of which
      // customer it's acting as.
      const bareCustomerContext: TenantContextInput = { userId: platformUserId, organizationId: customerOrgAId, isPlatformStaff: false };
      expect(await withTenantContext(bareCustomerContext, (tx) => tx.project.findMany({ where: { id: { in: [a.project.id, b.project.id] } } }))).toEqual([]);

      // A platform-context read sees BOTH customers' projects (this domain
      // is platform-owned; the customer split lives in `customerOrganizationId`,
      // not in `organizationId`/RLS) — confirms the visibility boundary is
      // exactly `tenant_is_platform_context()`, not per-customer.
      const both = await withTenantContext(platformContext(), (tx) => tx.project.findMany({ where: { id: { in: [a.project.id, b.project.id] } } }));
      expect(both.map((p) => p.id).sort()).toEqual([a.project.id, b.project.id].sort());
    });

    it("denies DELETE on every Build 27 table", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      const approval = await withTenantContext(platformContext(), (tx) => projectApprovalRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, resourceType: "PROJECT", resourceId: graph.project.id, requestedByUserId: platformUserId, visibility: "INTERNAL" }, tx));
      const qa = await withTenantContext(platformContext(), (tx) => projectQaCheckRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: null, milestoneId: null, title: "QA", required: true }, tx));
      const comment = await withTenantContext(platformContext(), (tx) => projectCommentRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: null, authorUserId: platformUserId, body: "hi", visibility: "INTERNAL" }, tx));
      const attachment = await withTenantContext(platformContext(), (tx) => projectAttachmentRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: null, title: "File", description: null, externalUrl: null, visibility: "INTERNAL", uploadedByUserId: platformUserId }, tx));

      // Each attempt gets its OWN transaction (mirrors
      // `client-onboarding-rls.test.ts`'s own identical DELETE-denial
      // test) — a single shared transaction would abort entirely after
      // the first permission-denied error, poisoning every later
      // statement regardless of which table it targets.
      const attempts = [
        withTenantContext(platformContext(), (tx) => tx.projectComment.deleteMany({ where: { id: comment.id } })),
        withTenantContext(platformContext(), (tx) => tx.projectAttachment.deleteMany({ where: { id: attachment.id } })),
        withTenantContext(platformContext(), (tx) => tx.projectApproval.deleteMany({ where: { id: approval.id } })),
        withTenantContext(platformContext(), (tx) => tx.projectQaCheck.deleteMany({ where: { id: qa.id } })),
        withTenantContext(platformContext(), (tx) => tx.projectTask.deleteMany({ where: { id: graph.subtask.id } })),
        withTenantContext(platformContext(), (tx) => tx.milestone.deleteMany({ where: { id: graph.milestone.id } })),
        withTenantContext(platformContext(), (tx) => tx.project.deleteMany({ where: { id: graph.project.id } })),
      ];
      const outcomes = await Promise.all(attempts.map((attempt) => attempt.then((result) => ({ count: result.count })).catch((error) => ({ error }))));
      for (const outcome of outcomes) {
        if ("count" in outcome) expect(outcome.count).toBe(0);
        else expect(outcome.error).toBeDefined();
      }
      // Every row is still there.
      const stillThere = await withTenantContext(platformContext(), (tx) => tx.project.findUnique({ where: { id: graph.project.id } }));
      expect(stillThere).not.toBeNull();
    });
  });

  describe("relationship-integrity trigger", () => {
    it("rejects a Milestone-scoped task whose milestone belongs to another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectTaskRepository.create(
            { id: generateId(), organizationId: platformOrgId, projectId: a.project.id, milestoneId: b.milestone.id, parentTaskId: null, title: "Forged", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 1, customerVisible: false, createdByUserId: platformUserId },
            tx,
          ),
        ),
        "milestone must belong to the same project",
      );
    });

    it("rejects a subtask whose parent belongs to another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectTaskRepository.create(
            { id: generateId(), organizationId: platformOrgId, projectId: a.project.id, milestoneId: null, parentTaskId: b.rootTask.id, title: "Forged", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 1, customerVisible: false, createdByUserId: platformUserId },
            tx,
          ),
        ),
        "parent must belong to the same project",
      );
    });

    it("rejects nesting a subtask under another subtask (one level deep only)", async () => {
      const a = await seedFullGraph(customerOrgAId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectTaskRepository.create(
            { id: generateId(), organizationId: platformOrgId, projectId: a.project.id, milestoneId: null, parentTaskId: a.subtask.id, title: "Forged grandchild", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 1, customerVisible: false, createdByUserId: platformUserId },
            tx,
          ),
        ),
        "one level deep",
      );
    });

    it("rejects a dependency whose prerequisite task belongs to another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectTaskDependencyRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, taskId: a.rootTask.id, dependsOnTaskId: b.rootTask.id, createdByUserId: platformUserId }, tx)),
        "prerequisite task must belong to the same project",
      );
    });

    it("rejects a comment on a task from another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectCommentRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, taskId: b.rootTask.id, authorUserId: platformUserId, body: "forged", visibility: "INTERNAL" }, tx)),
        "task must belong to the same project",
      );
    });

    it("rejects an attachment on a task from another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectAttachmentRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, taskId: b.rootTask.id, title: "forged", description: null, externalUrl: null, visibility: "INTERNAL", uploadedByUserId: platformUserId }, tx)),
        "task must belong to the same project",
      );
    });

    it("rejects a PROJECT-type approval whose resourceId isn't its own project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectApprovalRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, resourceType: "PROJECT", resourceId: b.project.id, requestedByUserId: platformUserId, visibility: "INTERNAL" }, tx)),
        "PROJECT resource must equal its project",
      );
    });

    it("rejects a MILESTONE-type approval whose milestone belongs to another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectApprovalRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, resourceType: "MILESTONE", resourceId: b.milestone.id, requestedByUserId: platformUserId, visibility: "INTERNAL" }, tx)),
        "milestone must belong to the same project",
      );
    });

    it("rejects a QA check whose task or milestone belongs to another project", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const b = await seedFullGraph(customerOrgBId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectQaCheckRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, taskId: b.rootTask.id, milestoneId: null, title: "forged", required: true }, tx)),
        "task must belong to the same project",
      );
      await expectPgError(
        withTenantContext(platformContext(), (tx) => projectQaCheckRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: a.project.id, taskId: null, milestoneId: b.milestone.id, title: "forged", required: true }, tx)),
        "milestone must belong to the same project",
      );
    });

    it("rejects a project whose originating onboarding belongs to another customer organization", async () => {
      const a = await seedFullGraph(customerOrgAId);
      const onboardingB = await seedOnboarding(customerOrgBId, (await seedCompany(customerOrgBId)));
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectRepository.create(
            { id: generateId(), organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId: a.companyId, originatingOnboardingId: onboardingB.onboarding.id, sourceServiceItemId: null, sourceTemplateId: null, title: "Forged", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId },
            tx,
          ),
        ),
        "same customer organization and company",
      );
    });

    it("rejects a project's source service item that doesn't belong to its own originating onboarding", async () => {
      const companyA = await seedCompany(customerOrgAId);
      const onboardingA = await seedOnboarding(customerOrgAId, companyA);
      // A distinct THIRD customer organization/company for the "other"
      // onboarding — `convertedToOrganizationId` is globally unique
      // (one company per customer organization), so this cannot reuse
      // `customerOrgAId`/`customerOrgBId`.
      const otherCustomerOrgId = await createOrganization("Project Mgmt RLS Customer C");
      const companyOther = await seedCompany(otherCustomerOrgId);
      const onboardingOther = await seedOnboarding(otherCustomerOrgId, companyOther);
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectRepository.create(
            {
              id: generateId(),
              organizationId: platformOrgId,
              customerOrganizationId: customerOrgAId,
              companyId: companyA,
              originatingOnboardingId: onboardingA.onboarding.id,
              sourceServiceItemId: onboardingOther.serviceItemId,
              sourceTemplateId: null,
              title: "Forged",
              description: null,
              priority: "MEDIUM",
              ownerUserId: null,
              startDate: null,
              targetEndDate: null,
              createdByUserId: platformUserId,
            },
            tx,
          ),
        ),
        "must belong to the originating onboarding",
      );
    });

    it("rejects a template task whose milestone belongs to another template", async () => {
      const templateAId = generateId();
      const templateBId = generateId();
      templateIds.push(templateAId, templateBId);
      const milestoneB = await withTenantContext(platformContext(), async (tx) => {
        await projectTemplateRepository.create({ id: templateAId, organizationId: platformOrgId, name: `Template A ${templateAId}`, description: null, createdByUserId: platformUserId }, tx);
        await projectTemplateRepository.create({ id: templateBId, organizationId: platformOrgId, name: `Template B ${templateBId}`, description: null, createdByUserId: platformUserId }, tx);
        return projectTemplateMilestoneRepository.create({ id: generateId(), organizationId: platformOrgId, templateId: templateBId, title: "B Milestone", description: null, sortOrder: 1000, relativeDueDays: null, customerVisible: false }, tx);
      });
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectTemplateTaskRepository.create(
            { id: generateId(), organizationId: platformOrgId, templateId: templateAId, templateMilestoneId: milestoneB.id, title: "Forged", description: null, sortOrder: 1000, relativeDueDays: null, priority: "MEDIUM", customerVisible: false, defaultAssigneeRoleHint: null },
            tx,
          ),
        ),
        "must belong to the same template",
      );
    });
  });

  describe("CHECK constraints", () => {
    it("requires a non-blank cancellation reason on Project/Milestone/ProjectTask", async () => {
      // Space characters specifically — `BTRIM()` with no second argument
      // trims ONLY spaces (not tabs/newlines), the same discipline every
      // other `NULLIF(BTRIM(...), '') IS NOT NULL` constraint in this
      // codebase relies on; a tab-only "reason" would NOT be caught by
      // this constraint, which is this convention's own known, accepted
      // narrowness (see project-management.md "Known limitations") —
      // not something to (mis-)verify here.
      const graph = await seedFullGraph(customerOrgAId);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.project.update({ where: { id: graph.project.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: "   ", cancelledByUserId: platformUserId } })));
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.milestone.update({ where: { id: graph.milestone.id }, data: { cancelledAt: new Date(), cancelledReason: "  ", cancelledByUserId: platformUserId } })));
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.projectTask.update({ where: { id: graph.rootTask.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: "   ", cancelledByUserId: platformUserId } })));
    });

    it("requires a non-blank completion override reason", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.project.update({ where: { id: graph.project.id }, data: { status: "COMPLETED", completedAt: new Date(), completedByUserId: platformUserId, completionOverride: true, completionOverrideReason: "  " } })));
    });

    it("rejects a self-dependency", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      await expectPgError(withTenantContext(platformContext(), (tx) => projectTaskDependencyRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: graph.rootTask.id, dependsOnTaskId: graph.rootTask.id, createdByUserId: platformUserId }, tx)));
    });

    it("rejects self-approval at the database layer", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      const approval = await withTenantContext(platformContext(), (tx) => projectApprovalRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, resourceType: "PROJECT", resourceId: graph.project.id, requestedByUserId: platformUserId, visibility: "INTERNAL" }, tx));
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.projectApproval.update({ where: { id: approval.id }, data: { status: "APPROVED", approverUserId: platformUserId, decidedAt: new Date() } })));
    });

    it("requires a non-blank reason when rejecting an approval", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      const otherApprover = await createUser("pm-approver");
      const approval = await withTenantContext(platformContext(), (tx) => projectApprovalRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, resourceType: "PROJECT", resourceId: graph.project.id, requestedByUserId: platformUserId, visibility: "INTERNAL" }, tx));
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.projectApproval.update({ where: { id: approval.id }, data: { status: "REJECTED", approverUserId: otherApprover, decidedAt: new Date(), reason: null } })));
    });

    it("rejects a QA check scoped to both a task and a milestone", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      await expectPgError(withTenantContext(platformContext(), (tx) => projectQaCheckRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: graph.rootTask.id, milestoneId: graph.milestone.id, title: "forged", required: true }, tx)));
    });

    it("rejects a task set as its own parent", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.projectTask.update({ where: { id: graph.rootTask.id }, data: { parentTaskId: graph.rootTask.id } })));
    });

    it("rejects a target end date before the start date", async () => {
      const companyId = await seedCompany(customerOrgAId);
      const start = new Date("2026-06-01T00:00:00Z");
      const before = new Date("2026-05-01T00:00:00Z");
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectRepository.create(
            { id: generateId(), organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: null, sourceServiceItemId: null, sourceTemplateId: null, title: "Forged dates", description: null, priority: "MEDIUM", ownerUserId: null, startDate: start, targetEndDate: before, createdByUserId: platformUserId },
            tx,
          ),
        ),
      );
    });
  });

  describe("idempotency — onboarding handoff", () => {
    it("enforces one active project per (originatingOnboardingId, sourceServiceItemId = NULL) — the 'whole onboarding' key", async () => {
      const companyId = await seedCompany(customerOrgAId);
      const { onboarding } = await seedOnboarding(customerOrgAId, companyId);
      const first = generateId();
      projectIds.push(first);
      await withTenantContext(platformContext(), (tx) =>
        projectRepository.create({ id: first, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: onboarding.id, sourceServiceItemId: null, sourceTemplateId: null, title: "First", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId, status: "PLANNED" }, tx),
      );
      const second = generateId();
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectRepository.create({ id: second, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: onboarding.id, sourceServiceItemId: null, sourceTemplateId: null, title: "Second", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId, status: "PLANNED" }, tx),
        ),
      );
    });

    it("allows a second project once the first is CANCELLED (the partial index excludes CANCELLED)", async () => {
      const companyId = await seedCompany(customerOrgAId);
      const { onboarding } = await seedOnboarding(customerOrgAId, companyId);
      const first = generateId();
      projectIds.push(first);
      await withTenantContext(platformContext(), async (tx) => {
        await projectRepository.create({ id: first, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: onboarding.id, sourceServiceItemId: null, sourceTemplateId: null, title: "First", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId, status: "PLANNED" }, tx);
        await tx.project.update({ where: { id: first }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: "Superseded", cancelledByUserId: platformUserId } });
      });
      const second = generateId();
      projectIds.push(second);
      await expect(
        withTenantContext(platformContext(), (tx) =>
          projectRepository.create({ id: second, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: onboarding.id, sourceServiceItemId: null, sourceTemplateId: null, title: "Second", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId, status: "PLANNED" }, tx),
        ),
      ).resolves.toBeDefined();
    });

    it("enforces one active project per sourceServiceItemId independently of the whole-onboarding key", async () => {
      const companyId = await seedCompany(customerOrgAId);
      const { onboarding, serviceItemId } = await seedOnboarding(customerOrgAId, companyId);
      const first = generateId();
      projectIds.push(first);
      await withTenantContext(platformContext(), (tx) =>
        projectRepository.create({ id: first, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: onboarding.id, sourceServiceItemId: serviceItemId, sourceTemplateId: null, title: "Per-item", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId, status: "PLANNED" }, tx),
      );
      const second = generateId();
      await expectPgError(
        withTenantContext(platformContext(), (tx) =>
          projectRepository.create({ id: second, organizationId: platformOrgId, customerOrganizationId: customerOrgAId, companyId, originatingOnboardingId: onboarding.id, sourceServiceItemId: serviceItemId, sourceTemplateId: null, title: "Duplicate per-item", description: null, priority: "MEDIUM", ownerUserId: null, startDate: null, targetEndDate: null, createdByUserId: platformUserId, status: "PLANNED" }, tx),
        ),
      );
    });
  });

  describe("concurrency — CAS races", () => {
    it("allows exactly one of two concurrent SQL task-completion CAS updates", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      const complete = () =>
        withTenantContext(platformContext(), (tx) =>
          tx.$executeRaw`
            UPDATE project_tasks
               SET status = 'DONE', completed_at = NOW(), completed_by_user_id = ${platformUserId}::uuid, updated_at = NOW()
             WHERE id = ${graph.rootTask.id}::uuid AND status NOT IN ('DONE', 'CANCELLED')
          `,
        );
      const counts = await Promise.all([complete(), complete()]);
      expect([...counts].sort()).toEqual([0, 1]);
    });

    it("allows exactly one of two concurrent SQL project-completion CAS updates", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      await withTenantContext(platformContext(), (tx) => tx.project.update({ where: { id: graph.project.id }, data: { status: "ACTIVE" } }));
      const complete = () =>
        withTenantContext(platformContext(), (tx) =>
          tx.$executeRaw`
            UPDATE projects
               SET status = 'COMPLETED', completed_at = NOW(), completed_by_user_id = ${platformUserId}::uuid, updated_at = NOW()
             WHERE id = ${graph.project.id}::uuid AND status = 'ACTIVE'
          `,
        );
      const counts = await Promise.all([complete(), complete()]);
      expect([...counts].sort()).toEqual([0, 1]);
    });
  });

  describe("dependency cycle prevention (service-layer algorithm, exercised against real rows)", () => {
    it("REQUIRED CASE: rejects closing A -> B -> C back into C -> A, verified against real created rows", async () => {
      const graph = await seedFullGraph(customerOrgAId);
      const taskB = await withTenantContext(platformContext(), (tx) =>
        projectTaskRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, milestoneId: null, parentTaskId: null, title: "B", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 2000, customerVisible: false, createdByUserId: platformUserId }, tx),
      );
      const taskC = await withTenantContext(platformContext(), (tx) =>
        projectTaskRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, milestoneId: null, parentTaskId: null, title: "C", description: null, priority: "MEDIUM", assignedToUserId: null, dueDate: null, sortOrder: 3000, customerVisible: false, createdByUserId: platformUserId }, tx),
      );
      const taskA = graph.rootTask;
      // "B depends on A" and "C depends on B" already exist.
      await withTenantContext(platformContext(), (tx) => projectTaskDependencyRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: taskB.id, dependsOnTaskId: taskA.id, createdByUserId: platformUserId }, tx));
      await withTenantContext(platformContext(), (tx) => projectTaskDependencyRepository.create({ id: generateId(), organizationId: platformOrgId, projectId: graph.project.id, taskId: taskC.id, dependsOnTaskId: taskB.id, createdByUserId: platformUserId }, tx));

      const existingEdges = await withTenantContext(platformContext(), (tx) => projectTaskDependencyRepository.listEdgesForProject(graph.project.id, tx));
      // Adding "A depends on C" would close the loop A -> B -> C -> A.
      expect(wouldCreateCycle(existingEdges, { taskId: taskA.id, dependsOnTaskId: taskC.id })).toBe(true);
    });
  });
});
