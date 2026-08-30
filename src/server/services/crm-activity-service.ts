import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmActivityRepository, type CrmActivityWithActor } from "@/server/repositories/crm-activity-repository";
import { crmLeadRepository } from "@/server/repositories/crm-lead-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmContactRepository } from "@/server/repositories/crm-contact-repository";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { CrmActivity } from "@/generated/prisma/client";

/**
 * CRM activity logging — notes, calls, emails, meetings (see
 * crm-architecture.md "Activities are immutable"). `crm.manage` to log
 * one, `crm.read` to view a parent's activity timeline. There is no
 * update/delete here at all — the RLS layer has no UPDATE/DELETE policy
 * on `crm_activities` to match (see the migration's own comment); a
 * mistaken entry is corrected by logging a new, correcting activity, the
 * same append-only discipline an accounting ledger uses.
 *
 * Individual activities are NOT separately audited (see
 * `audit/catalog.ts`'s own CRM comment) — the activity row itself is the
 * durable record.
 */

const parentSchema = z
  .object({ leadId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), contactId: z.string().uuid().optional() })
  .refine((v) => [v.leadId, v.companyId, v.contactId].filter(Boolean).length === 1, { message: "Exactly one of leadId, companyId, or contactId is required." });

const logActivitySchema = z
  .object({
    type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING"]),
    body: z.string().max(4000).nullable().optional(),
    callDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    callOutcome: z.enum(["CONNECTED", "VOICEMAIL", "NO_ANSWER", "WRONG_NUMBER"]).nullable().optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .and(parentSchema);

/** `type: "STATUS_CHANGE"` is deliberately not accepted here — that activity kind is only ever written by `crm-lead-service.ts`'s own `changeLeadStatus()`, atomically with the status write it documents (see that file's own comment); a caller logging one by hand here could disagree with the lead's actual `status` column. */
export async function logActivity(rawInput: unknown): Promise<CrmActivity> {
  const input = parseOrThrow(logActivitySchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  if (input.type === "CALL" && !input.callOutcome) throw new ValidationError("callOutcome is required for a CALL activity.");

  return withTenantContext(tenantScope, async (tx) => {
    await assertParentBelongsToOrganization(input, organizationId, tx);
    return crmActivityRepository.create(
      {
        id: generateId(),
        organizationId,
        leadId: input.leadId ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        type: input.type,
        body: input.body ?? null,
        callDurationSeconds: input.type === "CALL" ? (input.callDurationSeconds ?? null) : null,
        callOutcome: input.type === "CALL" ? (input.callOutcome ?? null) : null,
        actorUserId: context.user!.id,
        occurredAt: input.occurredAt,
      },
      tx,
    );
  });
}

async function assertParentBelongsToOrganization(
  input: { leadId?: string; companyId?: string; contactId?: string },
  organizationId: string,
  tx: Parameters<typeof crmLeadRepository.findById>[1],
): Promise<void> {
  if (input.leadId) {
    const lead = await crmLeadRepository.findById(input.leadId, tx);
    if (!lead || lead.organizationId !== organizationId) throw new ValidationError("leadId does not reference a valid lead.");
  } else if (input.companyId) {
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new ValidationError("companyId does not reference a valid company.");
  } else if (input.contactId) {
    const contact = await crmContactRepository.findById(input.contactId, tx);
    if (!contact || contact.organizationId !== organizationId) throw new ValidationError("contactId does not reference a valid contact.");
  }
}

const listForLeadSchema = z.object({ leadId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function listActivitiesForLead(rawInput: unknown): Promise<OffsetPaginatedResult<CrmActivityWithActor>> {
  const input = parseOrThrow(listForLeadSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };

  return withTenantContext(tenantScope, async (tx) => {
    const lead = await crmLeadRepository.findById(input.leadId, tx);
    if (!lead || lead.organizationId !== organizationId) throw new NotFoundError("Lead");
    return crmActivityRepository.listForLead(input.leadId, params, tx);
  });
}

const listForCompanySchema = z.object({ companyId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function listActivitiesForCompany(rawInput: unknown): Promise<OffsetPaginatedResult<CrmActivityWithActor>> {
  const input = parseOrThrow(listForCompanySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };

  return withTenantContext(tenantScope, async (tx) => {
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new NotFoundError("Company");
    return crmActivityRepository.listForCompany(input.companyId, params, tx);
  });
}

const listForContactSchema = z.object({ contactId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function listActivitiesForContact(rawInput: unknown): Promise<OffsetPaginatedResult<CrmActivityWithActor>> {
  const input = parseOrThrow(listForContactSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };

  return withTenantContext(tenantScope, async (tx) => {
    const contact = await crmContactRepository.findById(input.contactId, tx);
    if (!contact || contact.organizationId !== organizationId) throw new NotFoundError("Contact");
    return crmActivityRepository.listForContact(input.contactId, params, tx);
  });
}
