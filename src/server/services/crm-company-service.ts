import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmCompanyRepository, type CrmCompanyListFilters } from "@/server/repositories/crm-company-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmCompany, CrmCompanyStatus } from "@/generated/prisma/client";

/**
 * CRM company lifecycle (Build 19 / Roadmap 13) — `crm.manage` for every
 * mutation, `crm.read` for listing/viewing. `CrmCompany` is Alpha Page
 * Rankers' own sales-target/prospect record, distinct from `Organization`
 * (a real tenant with a login) — see crm-architecture.md "Organization
 * vs CRM Company." Mirrors `knowledge-source-service.ts`'s own shape:
 * parse -> authorize -> short `withTenantContext()` transaction -> audit.
 */

async function auditCompanyCreated(context: AuthorizationContext, organizationId: string, companyId: string, companyName: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.company.created", organizationId, resourceType: "crm_company", resourceId: companyId, resourceName: companyName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.company.created", error));
}

async function auditCompanyArchived(context: AuthorizationContext, organizationId: string, companyId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.company.archived", organizationId, resourceType: "crm_company", resourceId: companyId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.company.archived", error));
}

const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
});

export async function createCompany(rawInput: unknown): Promise<CrmCompany> {
  const input = parseOrThrow(createCompanySchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const id = generateId();
  const company = await withTenantContext(tenantScope, (tx) =>
    crmCompanyRepository.create({ id, organizationId, name: input.name, domain: input.domain ?? null, industry: input.industry ?? null, website: input.website ?? null, phone: input.phone ?? null }, tx),
  );

  await auditCompanyCreated(context, organizationId, id, input.name);
  return company;
}

const listCompaniesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  search: z.string().max(200).optional(),
});

export async function listCompanies(rawInput: unknown): Promise<OffsetPaginatedResult<CrmCompany>> {
  const input = parseOrThrow(listCompaniesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: CrmCompanyListFilters = { status: input.status, search: input.search };

  return withTenantContext(tenantScope, (tx) => crmCompanyRepository.listForOrganization(organizationId, params, filters, tx));
}

const getCompanySchema = z.object({ companyId: z.string().uuid() });

export async function getCompany(rawInput: unknown): Promise<CrmCompany> {
  const input = parseOrThrow(getCompanySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");

  const company = await withTenantContext(tenantScope, (tx) => crmCompanyRepository.findById(input.companyId, tx));
  if (!company) throw new NotFoundError("Company");
  // Defense in depth beyond RLS — never trust a resolved row's tenant
  // ownership without re-checking it, the same discipline `knowledge-
  // source-service.ts`'s own `getSource()` establishes.
  if (company.organizationId !== organizationId) throw new NotFoundError("Company");
  return company;
}

const updateCompanySchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
});

export async function updateCompany(rawInput: unknown): Promise<CrmCompany> {
  const input = parseOrThrow(updateCompanySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmCompanyRepository.findById(input.companyId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Company");
    const { companyId, ...data } = input;
    return crmCompanyRepository.update(companyId, data, tx);
  });
}

const archiveCompanySchema = z.object({ companyId: z.string().uuid() });

export async function archiveCompany(rawInput: unknown): Promise<CrmCompany> {
  const input = parseOrThrow(archiveCompanySchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const archived = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmCompanyRepository.findById(input.companyId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Company");
    return crmCompanyRepository.archive(input.companyId, tx);
  });

  await auditCompanyArchived(context, organizationId, input.companyId);
  return archived;
}

const reactivateCompanySchema = z.object({ companyId: z.string().uuid() });

export async function reactivateCompany(rawInput: unknown): Promise<CrmCompany> {
  const input = parseOrThrow(reactivateCompanySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmCompanyRepository.findById(input.companyId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Company");
    return crmCompanyRepository.reactivate(input.companyId, tx);
  });
}

export type { CrmCompanyStatus };
