import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmLeadSourceRepository } from "@/server/repositories/crm-lead-source-repository";
import { NotFoundError } from "@/lib/errors/app-error";
import type { CrmLeadSource } from "@/generated/prisma/client";

/**
 * CRM lead-source management (Build 19 / Roadmap 13's own "Lead sources"
 * scope) — a small settings-style list, `crm.manage` to create/edit,
 * `crm.read` to list. Not separately audited (see `audit/catalog.ts`'s
 * own CRM comment — settings-style CRUD here is routine, not a
 * governance-significant event the way company/contact/lead lifecycle
 * is).
 */

const createLeadSourceSchema = z.object({ name: z.string().min(1).max(100) });

export async function createLeadSource(rawInput: unknown): Promise<CrmLeadSource> {
  const input = parseOrThrow(createLeadSourceSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const id = generateId();
  return withTenantContext(tenantScope, (tx) => crmLeadSourceRepository.create({ id, organizationId, name: input.name }, tx));
}

export async function listLeadSources(): Promise<CrmLeadSource[]> {
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  return withTenantContext(tenantScope, (tx) => crmLeadSourceRepository.listForOrganization(organizationId, tx));
}

const updateLeadSourceSchema = z.object({ leadSourceId: z.string().uuid(), name: z.string().min(1).max(100).optional(), isActive: z.boolean().optional() });

export async function updateLeadSource(rawInput: unknown): Promise<CrmLeadSource> {
  const input = parseOrThrow(updateLeadSourceSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmLeadSourceRepository.findById(input.leadSourceId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Lead source");
    const { leadSourceId, ...data } = input;
    return crmLeadSourceRepository.update(leadSourceId, data, tx);
  });
}
