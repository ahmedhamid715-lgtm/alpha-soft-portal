import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("CRM Row-Level Security (database integration)", () => {
  let customerOrgId: string;
  let platformOrgId: string;
  let actorUserId: string;
  const companyIds: string[] = [];
  const contactIds: string[] = [];
  const sourceIds: string[] = [];
  const leadIds: string[] = [];
  const activityIds: string[] = [];
  const taskIds: string[] = [];
  const definitionIds: string[] = [];
  const valueIds: string[] = [];

  const platformContext = () => ({ userId: actorUserId, organizationId: platformOrgId, isPlatformStaff: true });
  const customerContext = () => ({ userId: null, organizationId: customerOrgId, isPlatformStaff: false });
  // Synthetic platform context for the second organization. Application
  // authorization never issues this context (CRM is platform-only), but it
  // lets this database test isolate and prove the organization-id half of
  // every RLS policy independently from the platform-context conjunct.
  const secondTenantContext = () => ({ userId: actorUserId, organizationId: customerOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    customerOrgId = generateId();
    await organizationRepository.create({
      id: customerOrgId,
      name: "CRM RLS Customer Org",
      displayName: "CRM RLS Customer Org",
      slug: `crm-rls-customer-${customerOrgId}`,
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
    if (valueIds.length) await db.crmCustomFieldValue.deleteMany({ where: { id: { in: valueIds } } });
    if (activityIds.length) await db.crmActivity.deleteMany({ where: { id: { in: activityIds } } });
    if (taskIds.length) await db.crmTask.deleteMany({ where: { id: { in: taskIds } } });
    if (leadIds.length) await db.crmLead.deleteMany({ where: { id: { in: leadIds } } });
    if (contactIds.length) await db.crmContact.deleteMany({ where: { id: { in: contactIds } } });
    if (definitionIds.length) await db.crmCustomFieldDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    if (sourceIds.length) await db.crmLeadSource.deleteMany({ where: { id: { in: sourceIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    await db.organization.delete({ where: { id: customerOrgId } });

    companyIds.length = 0;
    contactIds.length = 0;
    sourceIds.length = 0;
    leadIds.length = 0;
    activityIds.length = 0;
    taskIds.length = 0;
    definitionIds.length = 0;
    valueIds.length = 0;
  });

  async function seedCompany() {
    const company = await withTenantContext(platformContext(), (tx) =>
      tx.crmCompany.create({ data: { id: generateId(), organizationId: platformOrgId, name: "CRM RLS Company" } }),
    );
    companyIds.push(company.id);
    return company;
  }

  async function seedSecondTenantCompany() {
    const company = await db.crmCompany.create({
      data: { id: generateId(), organizationId: customerOrgId, name: "CRM RLS Second Tenant Company" },
    });
    companyIds.push(company.id);
    return company;
  }

  async function seedContact(companyId: string) {
    const contact = await withTenantContext(platformContext(), (tx) =>
      tx.crmContact.create({ data: { id: generateId(), organizationId: platformOrgId, companyId, firstName: "CRM", lastName: "Contact" } }),
    );
    contactIds.push(contact.id);
    return contact;
  }

  async function seedSource() {
    const source = await withTenantContext(platformContext(), (tx) =>
      tx.crmLeadSource.create({ data: { id: generateId(), organizationId: platformOrgId, name: `CRM RLS Source ${generateId()}` } }),
    );
    sourceIds.push(source.id);
    return source;
  }

  async function seedLead(companyId: string) {
    const lead = await withTenantContext(platformContext(), (tx) =>
      tx.crmLead.create({ data: { id: generateId(), organizationId: platformOrgId, companyId, title: "CRM RLS Lead" } }),
    );
    leadIds.push(lead.id);
    return lead;
  }

  async function seedActivity(companyId: string) {
    const activity = await withTenantContext(platformContext(), (tx) =>
      tx.crmActivity.create({ data: { id: generateId(), organizationId: platformOrgId, companyId, type: "NOTE", actorUserId } }),
    );
    activityIds.push(activity.id);
    return activity;
  }

  async function seedDefinition() {
    const definition = await withTenantContext(platformContext(), (tx) =>
      tx.crmCustomFieldDefinition.create({
        data: { id: generateId(), organizationId: platformOrgId, entityType: "COMPANY", key: `crm_rls_${generateId()}`, label: "CRM RLS", fieldType: "TEXT" },
      }),
    );
    definitionIds.push(definition.id);
    return definition;
  }

  describe("crm_companies (direct ownership)", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seedCompany();
      const seen = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.crmCompany.findMany({}));
      expect(seen).toEqual([]);
    });

    it("the customer organization cannot SELECT a platform-owned company", async () => {
      const company = await seedCompany();
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmCompany.findUnique({ where: { id: company.id } }));
      expect(seen).toBeNull();
    });

    it("a zero-WHERE findMany() under the customer context never returns a platform-owned company", async () => {
      await seedCompany();
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmCompany.findMany({}));
      expect(seen.every((company) => company.organizationId !== platformOrgId)).toBe(true);
    });

    it("two platform-capable tenant contexts each see only their own rows, including a zero-WHERE query", async () => {
      const orgACompany = await seedCompany();
      const orgBCompany = await seedSecondTenantCompany();

      const orgASeen = await withTenantContext(platformContext(), (tx) => tx.crmCompany.findMany({}));
      const orgBSeen = await withTenantContext(secondTenantContext(), (tx) => tx.crmCompany.findMany({}));

      expect(orgASeen.some((company) => company.id === orgACompany.id)).toBe(true);
      expect(orgASeen.some((company) => company.id === orgBCompany.id)).toBe(false);
      expect(orgASeen.every((company) => company.organizationId === platformOrgId)).toBe(true);
      expect(orgBSeen.some((company) => company.id === orgBCompany.id)).toBe(true);
      expect(orgBSeen.some((company) => company.id === orgACompany.id)).toBe(false);
      expect(orgBSeen.every((company) => company.organizationId === customerOrgId)).toBe(true);
    });

    it("a forged cross-tenant INSERT is rejected by WITH CHECK", async () => {
      await expect(
        withTenantContext(customerContext(), (tx) => tx.crmCompany.create({ data: { id: generateId(), organizationId: platformOrgId, name: "Forged CRM company" } })),
      ).rejects.toThrow();
    });

    it("a legitimate INSERT under the platform context succeeds", async () => {
      const company = await seedCompany();
      expect(company.organizationId).toBe(platformOrgId);
    });

    it("the customer organization cannot UPDATE a platform-owned company", async () => {
      const company = await seedCompany();
      const result = await withTenantContext(customerContext(), (tx) => tx.crmCompany.updateMany({ where: { id: company.id }, data: { name: "Forged update" } }));
      expect(result.count).toBe(0);
      expect((await db.crmCompany.findUnique({ where: { id: company.id } }))?.name).toBe("CRM RLS Company");
    });

    it("one platform-capable tenant context cannot mutate the other tenant's row", async () => {
      const orgBCompany = await seedSecondTenantCompany();
      const result = await withTenantContext(platformContext(), (tx) =>
        tx.crmCompany.updateMany({ where: { id: orgBCompany.id }, data: { name: "Cross-tenant mutation" } }),
      );
      expect(result.count).toBe(0);
      expect((await db.crmCompany.findUnique({ where: { id: orgBCompany.id } }))?.name).toBe("CRM RLS Second Tenant Company");
    });

    it("DELETE is refused outright for the platform context", async () => {
      const company = await seedCompany();
      await expect(withTenantContext(platformContext(), (tx) => tx.crmCompany.delete({ where: { id: company.id } }))).rejects.toThrow();
    });
  });

  describe("nested cross-tenant relationship integrity", () => {
    it("rejects a contact whose own tenant is Org A but whose company belongs to Org B", async () => {
      const orgBCompany = await seedSecondTenantCompany();
      const forgedId = generateId();
      contactIds.push(forgedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmContact.create({
            data: {
              id: forgedId,
              organizationId: platformOrgId,
              companyId: orgBCompany.id,
              firstName: "Forged",
              lastName: "Association",
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a lead whose own tenant is Org A but whose company belongs to Org B", async () => {
      const orgBCompany = await seedSecondTenantCompany();
      const forgedId = generateId();
      leadIds.push(forgedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmLead.create({
            data: { id: forgedId, organizationId: platformOrgId, companyId: orgBCompany.id, title: "Forged cross-tenant lead" },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects an activity and task whose own tenant is Org A but whose parent belongs to Org B", async () => {
      const orgBCompany = await seedSecondTenantCompany();
      const forgedActivityId = generateId();
      const forgedTaskId = generateId();
      activityIds.push(forgedActivityId);
      taskIds.push(forgedTaskId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmActivity.create({
            data: {
              id: forgedActivityId,
              organizationId: platformOrgId,
              companyId: orgBCompany.id,
              type: "NOTE",
              actorUserId,
            },
          }),
        ),
      ).rejects.toThrow();

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmTask.create({
            data: {
              id: forgedTaskId,
              organizationId: platformOrgId,
              companyId: orgBCompany.id,
              title: "Forged cross-tenant task",
              createdByUserId: actorUserId,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a platform definition value attached to an entity in another tenant", async () => {
      const definition = await seedDefinition();
      const orgBCompany = await seedSecondTenantCompany();
      const forgedId = generateId();
      valueIds.push(forgedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmCustomFieldValue.create({
            data: { id: forgedId, definitionId: definition.id, companyId: orgBCompany.id, valueText: "forged" },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a custom field value attached to the wrong CRM entity type", async () => {
      const definition = await seedDefinition();
      const lead = await seedLead((await seedCompany()).id);
      const forgedId = generateId();
      valueIds.push(forgedId);

      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmCustomFieldValue.create({
            data: { id: forgedId, definitionId: definition.id, leadId: lead.id, valueText: "wrong entity type" },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("other directly-owned CRM tables", () => {
    it("crm_contacts is not visible to the customer organization", async () => {
      const contact = await seedContact((await seedCompany()).id);
      expect(await withTenantContext(customerContext(), (tx) => tx.crmContact.findUnique({ where: { id: contact.id } }))).toBeNull();
    });

    it("crm_lead_sources accepts a legitimate platform insert", async () => {
      expect((await seedSource()).organizationId).toBe(platformOrgId);
    });

    it("crm_leads is not visible to the customer organization", async () => {
      const lead = await seedLead((await seedCompany()).id);
      expect(await withTenantContext(customerContext(), (tx) => tx.crmLead.findUnique({ where: { id: lead.id } }))).toBeNull();
    });

    it("crm_tasks accepts a legitimate platform insert", async () => {
      const company = await seedCompany();
      const task = await withTenantContext(platformContext(), (tx) =>
        tx.crmTask.create({ data: { id: generateId(), organizationId: platformOrgId, companyId: company.id, title: "CRM RLS task", createdByUserId: actorUserId } }),
      );
      taskIds.push(task.id);
      expect(task.organizationId).toBe(platformOrgId);
    });

    it("crm_custom_field_definitions is not visible to the customer organization", async () => {
      const definition = await seedDefinition();
      expect(await withTenantContext(customerContext(), (tx) => tx.crmCustomFieldDefinition.findUnique({ where: { id: definition.id } }))).toBeNull();
    });
  });

  describe("crm_activities (direct ownership, immutable)", () => {
    it("fails closed — with NO tenant context, nothing is visible", async () => {
      await seedActivity((await seedCompany()).id);
      expect(await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.crmActivity.findMany({}))).toEqual([]);
    });

    it("the customer organization cannot SELECT a platform-owned activity", async () => {
      const activity = await seedActivity((await seedCompany()).id);
      expect(await withTenantContext(customerContext(), (tx) => tx.crmActivity.findUnique({ where: { id: activity.id } }))).toBeNull();
    });

    it("a zero-WHERE findMany() under the customer context never returns a platform-owned activity", async () => {
      await seedActivity((await seedCompany()).id);
      const seen = await withTenantContext(customerContext(), (tx) => tx.crmActivity.findMany({}));
      expect(seen.every((activity) => activity.organizationId !== platformOrgId)).toBe(true);
    });

    it("a legitimate platform INSERT succeeds", async () => {
      const activity = await seedActivity((await seedCompany()).id);
      expect(activity.organizationId).toBe(platformOrgId);
    });

    it("UPDATE is refused outright even for the platform context", async () => {
      const activity = await seedActivity((await seedCompany()).id);
      await expect(withTenantContext(platformContext(), (tx) => tx.crmActivity.update({ where: { id: activity.id }, data: { body: "Cannot edit" } }))).rejects.toThrow();
    });

    it("DELETE is refused outright for the platform context", async () => {
      const activity = await seedActivity((await seedCompany()).id);
      await expect(withTenantContext(platformContext(), (tx) => tx.crmActivity.delete({ where: { id: activity.id } }))).rejects.toThrow();
    });

    it("rejects an activity with no associated CRM entity", async () => {
      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmActivity.create({ data: { id: generateId(), organizationId: platformOrgId, type: "NOTE", actorUserId } }),
        ),
      ).rejects.toThrow();
    });

    it("rejects an activity associated with two CRM entities", async () => {
      const company = await seedCompany();
      const contact = await seedContact(company.id);
      await expect(
        withTenantContext(platformContext(), (tx) =>
          tx.crmActivity.create({ data: { id: generateId(), organizationId: platformOrgId, companyId: company.id, contactId: contact.id, type: "NOTE", actorUserId } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("crm_custom_field_values (transitive ownership)", () => {
    it("rejects a customer-context INSERT referencing a platform-owned definition", async () => {
      const definition = await seedDefinition();
      const company = await seedCompany();
      await expect(
        withTenantContext(customerContext(), (tx) =>
          tx.crmCustomFieldValue.create({ data: { id: generateId(), definitionId: definition.id, companyId: company.id, valueText: "forged" } }),
        ),
      ).rejects.toThrow();
    });

    it("allows a platform-context INSERT referencing a platform-owned definition", async () => {
      const definition = await seedDefinition();
      const company = await seedCompany();
      const value = await withTenantContext(platformContext(), (tx) =>
        tx.crmCustomFieldValue.create({ data: { id: generateId(), definitionId: definition.id, companyId: company.id, valueText: "permitted" } }),
      );
      valueIds.push(value.id);
      expect(value.definitionId).toBe(definition.id);
    });
  });
});
