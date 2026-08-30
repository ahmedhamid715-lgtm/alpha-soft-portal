import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { crmLeadRepository } from "@/server/repositories/crm-lead-repository";

/**
 * Regression coverage for the three CONFIRMED findings from Build 19's
 * Phase 5 Codex security review (see crm-shared.ts's own
 * `assertPlatformStaffMember` comment, crm-lead-repository.ts's own
 * `changeStatus` comment, and crm-custom-field-service.ts's own
 * `assertValueMatchesFieldType` comment for what each fix actually
 * does). Same `vi.mock("@/lib/auth/session-guard")` + real-DB pattern
 * `knowledge-source-service.test.ts` already establishes — CRM services
 * genuinely need a resolved platform membership, not a mocked
 * `AuthorizationContext`.
 */
let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("CRM application-layer security fixes (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  const sourceIds: string[] = [];
  const leadIds: string[] = [];
  const taskIds: string[] = [];
  const definitionIds: string[] = [];
  let customerOrgId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    customerOrgId = generateId();
    await organizationRepository.create({ id: customerOrgId, name: "CRM Fix Test Org", displayName: "CRM Fix Test Org", slug: `crm-fix-org-${customerOrgId}` });
    orgIds.push(customerOrgId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
    platformOrgId = (await organizationRepository.findPlatformOrganization())!.id;
  });

  afterEach(async () => {
    if (taskIds.length) await db.crmTask.deleteMany({ where: { id: { in: taskIds } } });
    if (leadIds.length) await db.crmLead.deleteMany({ where: { id: { in: leadIds } } });
    if (contactIds.length) await db.crmContact.deleteMany({ where: { id: { in: contactIds } } });
    if (definitionIds.length) await db.crmCustomFieldDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    if (sourceIds.length) await db.crmLeadSource.deleteMany({ where: { id: { in: sourceIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    companyIds.length = 0;
    contactIds.length = 0;
    sourceIds.length = 0;
    leadIds.length = 0;
    taskIds.length = 0;
    definitionIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeMember(organizationId: string, roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  async function seedCompany() {
    const company = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
      tx.crmCompany.create({ data: { id: generateId(), organizationId: platformOrgId, name: "CRM Fix Test Company" } }),
    );
    companyIds.push(company.id);
    return company;
  }

  async function seedCustomerCrmGraph(actorUserId: string) {
    const company = await db.crmCompany.create({
      data: { id: generateId(), organizationId: customerOrgId, name: "Customer-tenant CRM company" },
    });
    companyIds.push(company.id);

    const contact = await db.crmContact.create({
      data: { id: generateId(), organizationId: customerOrgId, companyId: company.id, firstName: "Customer", lastName: "Contact" },
    });
    contactIds.push(contact.id);

    const source = await db.crmLeadSource.create({
      data: { id: generateId(), organizationId: customerOrgId, name: `Customer source ${generateId()}` },
    });
    sourceIds.push(source.id);

    const lead = await db.crmLead.create({
      data: { id: generateId(), organizationId: customerOrgId, companyId: company.id, primaryContactId: contact.id, sourceId: source.id, title: "Customer-tenant CRM lead" },
    });
    leadIds.push(lead.id);

    const task = await db.crmTask.create({
      data: { id: generateId(), organizationId: customerOrgId, companyId: company.id, title: "Customer-tenant CRM task", createdByUserId: actorUserId },
    });
    taskIds.push(task.id);

    const definition = await db.crmCustomFieldDefinition.create({
      data: { id: generateId(), organizationId: customerOrgId, entityType: "COMPANY", key: `customer_${generateId().replace(/-/g, "")}`, label: "Customer field", fieldType: "TEXT" },
    });
    definitionIds.push(definition.id);

    return { company, contact, source, lead, task, definition };
  }

  describe("authentication, authorization, mass assignment, and forged identifiers", () => {
    it("rejects unauthenticated and revoked-membership service invocation", async () => {
      const { listCompanies } = await import("@/server/services/crm-company-service");
      await expect(listCompanies({})).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });

      const admin = await makeMember(platformOrgId, "platform_admin", "crm-revoked-admin@example.com");
      actAs(admin.userId, { ...admin.membership, status: "SUSPENDED" });
      await expect(listCompanies({})).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    });

    it("allows crm.read but blocks a direct mutation for support_admin", async () => {
      const support = await makeMember(platformOrgId, "support_admin", "crm-read-only-support@example.com");
      actAs(support.userId, support.membership);

      const { listCompanies, createCompany } = await import("@/server/services/crm-company-service");
      await expect(listCompanies({ limit: 1 })).resolves.toMatchObject({ items: expect.any(Array) });
      await expect(createCompany({ name: "Forbidden mutation" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    });

    it("strips mass-assigned tenant and lifecycle fields instead of trusting them", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-mass-assignment@example.com");
      actAs(admin.userId, admin.membership);

      const { createCompany } = await import("@/server/services/crm-company-service");
      const company = await createCompany({
        name: "Mass assignment proof",
        organizationId: customerOrgId,
        status: "ARCHIVED",
        archivedAt: new Date(),
        convertedToOrganizationId: customerOrgId,
      });
      companyIds.push(company.id);

      expect(company.organizationId).toBe(platformOrgId);
      expect(company.status).toBe("ACTIVE");
      expect(company.archivedAt).toBeNull();
      expect(company.convertedToOrganizationId).toBeNull();
    });

    it("rejects existing CRM identifiers and associations from another tenant across every mutable service surface", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-forged-identifiers@example.com");
      actAs(admin.userId, admin.membership);
      const foreign = await seedCustomerCrmGraph(admin.userId);

      const { createContact, updateContact } = await import("@/server/services/crm-contact-service");
      const { createLead, changeLeadStatus } = await import("@/server/services/crm-lead-service");
      const { logActivity } = await import("@/server/services/crm-activity-service");
      const { createTask, completeTask } = await import("@/server/services/crm-task-service");
      const { updateLeadSource } = await import("@/server/services/crm-lead-source-service");
      const { updateCustomFieldDefinition, setCustomFieldValue } = await import("@/server/services/crm-custom-field-service");

      await expect(createContact({ companyId: foreign.company.id, firstName: "Forged", lastName: "Contact" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(updateContact({ contactId: foreign.contact.id, firstName: "Forged" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createLead({ companyId: foreign.company.id, title: "Forged lead" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(changeLeadStatus({ leadId: foreign.lead.id, status: "CONTACTED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(logActivity({ companyId: foreign.company.id, type: "NOTE", body: "Forged activity" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(createTask({ companyId: foreign.company.id, title: "Forged task" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(completeTask({ taskId: foreign.task.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateLeadSource({ leadSourceId: foreign.source.id, isActive: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateCustomFieldDefinition({ definitionId: foreign.definition.id, isActive: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(setCustomFieldValue({ definitionId: foreign.definition.id, companyId: foreign.company.id, valueText: "forged" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("assignee must be real platform staff (Finding 1 — HIGH)", () => {
    it("rejects a lead assignedToUserId that is only a customer-organization member", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin@example.com");
      const customerOnly = await makeMember(customerOrgId, "owner", "crm-fix-customer@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createLead } = await import("@/server/services/crm-lead-service");
      await expect(createLead({ companyId: company.id, title: "Test lead", assignedToUserId: customerOnly.userId })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("accepts a lead assignedToUserId that IS an active platform staff member", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin2@example.com");
      const otherStaff = await makeMember(platformOrgId, "platform_admin", "crm-fix-staff@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createLead } = await import("@/server/services/crm-lead-service");
      const lead = await createLead({ companyId: company.id, title: "Test lead", assignedToUserId: otherStaff.userId });
      leadIds.push(lead.id);
      expect(lead.assignedToUserId).toBe(otherStaff.userId);
    });

    it("rejects a task assignedToUserId that is only a customer-organization member", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin3@example.com");
      const customerOnly = await makeMember(customerOrgId, "owner", "crm-fix-customer2@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createTask } = await import("@/server/services/crm-task-service");
      await expect(createTask({ companyId: company.id, title: "Test task", assignedToUserId: customerOnly.userId })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("lead status transition is race-safe (Finding 2 — MEDIUM)", () => {
    it("crmLeadRepository.changeStatus() is a real compare-and-swap — a stale expectedStatus is refused, the current one succeeds", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin4@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();
      const lead = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) =>
        tx.crmLead.create({ data: { id: generateId(), organizationId: platformOrgId, companyId: company.id, title: "CAS test lead" } }),
      );
      leadIds.push(lead.id);

      // The lead's real status is NEW — asserting a stale/wrong
      // `expectedStatus` (as a concurrent loser would, having read the
      // row before a winning transition committed) must be refused, not
      // silently overwrite whatever the winner already wrote.
      const staleAttempt = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) => crmLeadRepository.changeStatus(lead.id, "QUALIFIED", "CONTACTED", {}, tx));
      expect(staleAttempt).toBeNull();

      const currentAttempt = await withTenantContext({ userId: null, organizationId: platformOrgId, isPlatformStaff: true }, (tx) => crmLeadRepository.changeStatus(lead.id, "CONTACTED", "NEW", {}, tx));
      expect(currentAttempt?.status).toBe("CONTACTED");
    });

    it("changeLeadStatus() surfaces the repository's compare-and-swap failure as a ConflictError, not a silent overwrite", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin4b@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createLead, changeLeadStatus } = await import("@/server/services/crm-lead-service");
      const { crmLeadRepository: repo } = await import("@/server/repositories/crm-lead-repository");
      const lead = await createLead({ companyId: company.id, title: "Race test lead" });
      leadIds.push(lead.id);

      // Simulates the exact race the fix defends against: another
      // transaction's compare-and-swap already won between this
      // caller's own read of `existing.status` and its own write.
      const spy = vi.spyOn(repo, "changeStatus").mockResolvedValueOnce(null);
      await expect(changeLeadStatus({ leadId: lead.id, status: "QUALIFIED" })).rejects.toMatchObject({ code: "CONFLICT" });
      spy.mockRestore();
    });

    it("a legitimate, uncontested transition still succeeds", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin5@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createLead, changeLeadStatus } = await import("@/server/services/crm-lead-service");
      const lead = await createLead({ companyId: company.id, title: "Happy path lead" });
      leadIds.push(lead.id);

      const updated = await changeLeadStatus({ leadId: lead.id, status: "CONTACTED" });
      expect(updated.status).toBe("CONTACTED");
    });
  });

  describe("task lifecycle is terminal and race-safe", () => {
    it("does not allow a completed task to be cancelled or completed again through direct service invocation", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-task-lifecycle@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createTask, completeTask, cancelTask } = await import("@/server/services/crm-task-service");
      const task = await createTask({ companyId: company.id, title: "Terminal task" });
      taskIds.push(task.id);
      await expect(completeTask({ taskId: task.id })).resolves.toMatchObject({ status: "COMPLETED" });
      await expect(cancelTask({ taskId: task.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(completeTask({ taskId: task.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("custom field value validation (Findings 3 & 4 — MEDIUM/LOW)", () => {
    it("rejects a SELECT value that isn't one of the field's configured options", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin6@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createCustomFieldDefinition, setCustomFieldValue } = await import("@/server/services/crm-custom-field-service");
      const definition = await createCustomFieldDefinition({ entityType: "COMPANY", key: `crm_fix_select_${generateId().replace(/-/g, "")}`, label: "Deal size", fieldType: "SELECT", options: ["Small", "Medium", "Large"] });

      await expect(setCustomFieldValue({ definitionId: definition.id, companyId: company.id, valueText: "Unconfigured option" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const value = await setCustomFieldValue({ definitionId: definition.id, companyId: company.id, valueText: "Medium" });
      expect(value.valueText).toBe("Medium");
    });

    it("rejects a non-finite/non-decimal NUMBER value", async () => {
      const admin = await makeMember(platformOrgId, "platform_admin", "crm-fix-admin7@example.com");
      actAs(admin.userId, admin.membership);
      const company = await seedCompany();

      const { createCustomFieldDefinition, setCustomFieldValue } = await import("@/server/services/crm-custom-field-service");
      const definition = await createCustomFieldDefinition({ entityType: "COMPANY", key: `crm_fix_number_${generateId().replace(/-/g, "")}`, label: "Budget", fieldType: "NUMBER" });

      await expect(setCustomFieldValue({ definitionId: definition.id, companyId: company.id, valueNumber: "Infinity" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const value = await setCustomFieldValue({ definitionId: definition.id, companyId: company.id, valueNumber: "1234.5" });
      expect(String(value.valueNumber)).toContain("1234.5");
    });
  });
});
