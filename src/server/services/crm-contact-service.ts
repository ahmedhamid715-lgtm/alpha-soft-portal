import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmContactRepository, type CrmContactListFilters } from "@/server/repositories/crm-contact-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmContact } from "@/generated/prisma/client";

/**
 * CRM contact lifecycle — `crm.manage` for mutations, `crm.read` for
 * listing/viewing. `CrmContact` is a person at a `CrmCompany` (a
 * prospect/lead's own point of contact), distinct from `User` (a real
 * Alpha OS account holder) — see crm-architecture.md "User vs CRM
 * Contact." Every contact requires a real, already-verified `companyId`
 * — there is no "contact without a company" state (schema.prisma's own
 * required FK).
 */

async function auditContactCreated(context: AuthorizationContext, organizationId: string, contactId: string, contactName: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.contact.created", organizationId, resourceType: "crm_contact", resourceId: contactId, resourceName: contactName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.contact.created", error));
}

async function auditContactArchived(context: AuthorizationContext, organizationId: string, contactId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.contact.archived", organizationId, resourceType: "crm_contact", resourceId: contactId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.contact.archived", error));
}

const createContactSchema = z.object({
  companyId: z.string().uuid(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
});

export async function createContact(rawInput: unknown): Promise<CrmContact> {
  const input = parseOrThrow(createContactSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const contact = await withTenantContext(tenantScope, async (tx) => {
    // Never trust a client-supplied `companyId` pairing alone — confirm
    // it's a real company in this same (the one platform) organization
    // before attaching a contact to it.
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new ValidationError("companyId does not reference a valid company.");

    const id = generateId();
    return crmContactRepository.create(
      { id, organizationId, companyId: input.companyId, firstName: input.firstName, lastName: input.lastName, email: input.email ?? null, phone: input.phone ?? null, jobTitle: input.jobTitle ?? null },
      tx,
    );
  });

  await auditContactCreated(context, organizationId, contact.id, `${input.firstName} ${input.lastName}`);
  return contact;
}

const listContactsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  companyId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

export async function listContacts(rawInput: unknown): Promise<OffsetPaginatedResult<CrmContact>> {
  const input = parseOrThrow(listContactsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: CrmContactListFilters = { status: input.status, companyId: input.companyId, search: input.search };

  return withTenantContext(tenantScope, (tx) => crmContactRepository.listForOrganization(organizationId, params, filters, tx));
}

const listContactsForCompanySchema = z.object({ companyId: z.string().uuid() });

export async function listContactsForCompany(rawInput: unknown): Promise<CrmContact[]> {
  const input = parseOrThrow(listContactsForCompanySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");

  return withTenantContext(tenantScope, async (tx) => {
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new NotFoundError("Company");
    return crmContactRepository.listForCompany(input.companyId, tx);
  });
}

const getContactSchema = z.object({ contactId: z.string().uuid() });

export async function getContact(rawInput: unknown): Promise<CrmContact> {
  const input = parseOrThrow(getContactSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");

  const contact = await withTenantContext(tenantScope, (tx) => crmContactRepository.findById(input.contactId, tx));
  if (!contact) throw new NotFoundError("Contact");
  if (contact.organizationId !== organizationId) throw new NotFoundError("Contact");
  return contact;
}

const updateContactSchema = z.object({
  contactId: z.string().uuid(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
});

export async function updateContact(rawInput: unknown): Promise<CrmContact> {
  const input = parseOrThrow(updateContactSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContactRepository.findById(input.contactId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contact");
    const { contactId, ...data } = input;
    return crmContactRepository.update(contactId, data, tx);
  });
}

const archiveContactSchema = z.object({ contactId: z.string().uuid() });

export async function archiveContact(rawInput: unknown): Promise<CrmContact> {
  const input = parseOrThrow(archiveContactSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const archived = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContactRepository.findById(input.contactId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contact");
    return crmContactRepository.archive(input.contactId, tx);
  });

  await auditContactArchived(context, organizationId, input.contactId);
  return archived;
}

const reactivateContactSchema = z.object({ contactId: z.string().uuid() });

export async function reactivateContact(rawInput: unknown): Promise<CrmContact> {
  const input = parseOrThrow(reactivateContactSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContactRepository.findById(input.contactId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contact");
    return crmContactRepository.reactivate(input.contactId, tx);
  });
}
