import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember } from "./crm-shared";
import { crmLeadRepository, type CrmLeadListFilters } from "@/server/repositories/crm-lead-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmContactRepository } from "@/server/repositories/crm-contact-repository";
import { crmLeadSourceRepository } from "@/server/repositories/crm-lead-source-repository";
import { crmActivityRepository } from "@/server/repositories/crm-activity-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmLead, CrmLeadStatus } from "@/generated/prisma/client";

/**
 * CRM lead lifecycle — `crm.manage` for mutations, `crm.read` for
 * listing/viewing. See crm-architecture.md "Lead lifecycle": NEW ->
 * CONTACTED -> QUALIFIED -> (CONVERTED | DISQUALIFIED), enforced here in
 * the service layer (the DB itself allows any status value — the state
 * machine is application logic, not a DB constraint, matching this
 * codebase's existing precedent of keeping transition rules in the
 * service layer rather than the schema). A lead never creates a
 * `Organization` on conversion — see `convertedAt`'s own comment below
 * and crm-architecture.md — that would blur CRM into Roadmap 14+'s
 * Client Onboarding, explicitly out of scope here.
 */

const VALID_TRANSITIONS: Record<CrmLeadStatus, CrmLeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "DISQUALIFIED"],
  CONTACTED: ["QUALIFIED", "DISQUALIFIED"],
  QUALIFIED: ["CONVERTED", "DISQUALIFIED"],
  CONVERTED: [],
  DISQUALIFIED: [],
};

async function auditLeadCreated(context: AuthorizationContext, organizationId: string, leadId: string, title: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.lead.created", organizationId, resourceType: "crm_lead", resourceId: leadId, resourceName: title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.lead.created", error));
}

async function auditLeadStatusChanged(context: AuthorizationContext, organizationId: string, leadId: string, from: CrmLeadStatus, to: CrmLeadStatus): Promise<void> {
  await audit
    .recordSuccess({
      action: "crm.lead.status_changed",
      organizationId,
      resourceType: "crm_lead",
      resourceId: leadId,
      previousState: { status: from },
      newState: { status: to },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record crm.lead.status_changed", error));
}

async function auditLeadConverted(context: AuthorizationContext, organizationId: string, leadId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.lead.converted", organizationId, resourceType: "crm_lead", resourceId: leadId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.lead.converted", error));
}

const createLeadSchema = z.object({
  companyId: z.string().uuid(),
  primaryContactId: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export async function createLead(rawInput: unknown): Promise<CrmLead> {
  const input = parseOrThrow(createLeadSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const lead = await withTenantContext(tenantScope, async (tx) => {
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new ValidationError("companyId does not reference a valid company.");

    if (input.primaryContactId) {
      const contact = await crmContactRepository.findById(input.primaryContactId, tx);
      if (!contact || contact.organizationId !== organizationId || contact.companyId !== input.companyId) {
        throw new ValidationError("primaryContactId must reference a contact belonging to the same company.");
      }
    }
    if (input.sourceId) {
      const source = await crmLeadSourceRepository.findById(input.sourceId, tx);
      if (!source || source.organizationId !== organizationId) throw new ValidationError("sourceId does not reference a valid lead source.");
    }
    if (input.assignedToUserId) {
      await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    }

    const id = generateId();
    return crmLeadRepository.create(
      { id, organizationId, companyId: input.companyId, primaryContactId: input.primaryContactId ?? null, sourceId: input.sourceId ?? null, title: input.title, description: input.description ?? null, assignedToUserId: input.assignedToUserId ?? null },
      tx,
    );
  });

  await auditLeadCreated(context, organizationId, lead.id, input.title);
  return lead;
}

const listLeadsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DISQUALIFIED"]).optional(),
  companyId: z.string().uuid().optional(),
  primaryContactId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

export async function listLeads(rawInput: unknown): Promise<OffsetPaginatedResult<CrmLead>> {
  const input = parseOrThrow(listLeadsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: CrmLeadListFilters = { status: input.status, companyId: input.companyId, primaryContactId: input.primaryContactId, assignedToUserId: input.assignedToUserId, search: input.search };

  return withTenantContext(tenantScope, (tx) => crmLeadRepository.listForOrganization(organizationId, params, filters, tx));
}

const getLeadSchema = z.object({ leadId: z.string().uuid() });

export async function getLead(rawInput: unknown): Promise<CrmLead> {
  const input = parseOrThrow(getLeadSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");

  const lead = await withTenantContext(tenantScope, (tx) => crmLeadRepository.findById(input.leadId, tx));
  if (!lead) throw new NotFoundError("Lead");
  if (lead.organizationId !== organizationId) throw new NotFoundError("Lead");
  return lead;
}

const updateLeadSchema = z.object({
  leadId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export async function updateLead(rawInput: unknown): Promise<CrmLead> {
  const input = parseOrThrow(updateLeadSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmLeadRepository.findById(input.leadId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Lead");

    if (input.primaryContactId) {
      const contact = await crmContactRepository.findById(input.primaryContactId, tx);
      if (!contact || contact.organizationId !== organizationId || contact.companyId !== existing.companyId) {
        throw new ValidationError("primaryContactId must reference a contact belonging to this lead's company.");
      }
    }
    if (input.sourceId) {
      const source = await crmLeadSourceRepository.findById(input.sourceId, tx);
      if (!source || source.organizationId !== organizationId) throw new ValidationError("sourceId does not reference a valid lead source.");
    }
    if (input.assignedToUserId) {
      await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    }

    const { leadId, ...data } = input;
    return crmLeadRepository.update(leadId, data, tx);
  });
}

const changeLeadStatusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(["CONTACTED", "QUALIFIED", "CONVERTED", "DISQUALIFIED"]),
  disqualifiedReason: z.string().max(1000).nullable().optional(),
});

/** Enforces `VALID_TRANSITIONS` and logs a `STATUS_CHANGE` activity in the same transaction as the status write — the activity IS the durable "why/when did this change" record (see crm-architecture.md "Activities are immutable"), not a second audit-log copy of the same fact. */
export async function changeLeadStatus(rawInput: unknown): Promise<CrmLead> {
  const input = parseOrThrow(changeLeadStatusSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  if (input.status === "DISQUALIFIED" && !input.disqualifiedReason) {
    throw new ValidationError("disqualifiedReason is required when disqualifying a lead.");
  }

  const { lead, fromStatus } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmLeadRepository.findById(input.leadId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Lead");
    if (!VALID_TRANSITIONS[existing.status].includes(input.status)) {
      throw new ValidationError(`Cannot transition a lead from ${existing.status} to ${input.status}.`);
    }

    // Conditional update (`WHERE status = existing.status`) — `null` means
    // another concurrent transition already moved this lead off the
    // status just read above; re-throwing as a conflict is correct even
    // though `existing.status` still *looked* valid a moment ago, rather
    // than silently overwriting whatever the winning transition already
    // committed. See `crmLeadRepository.changeStatus()`'s own comment.
    const updated = await crmLeadRepository.changeStatus(input.leadId, input.status, existing.status, { disqualifiedReason: input.disqualifiedReason }, tx);
    if (!updated) throw new ConflictError("This lead's status was just changed by someone else. Reload and try again.");
    await crmActivityRepository.create(
      {
        id: generateId(),
        organizationId,
        leadId: input.leadId,
        companyId: null,
        contactId: null,
        type: "STATUS_CHANGE",
        body: `Status changed from ${existing.status} to ${input.status}${input.disqualifiedReason ? `: ${input.disqualifiedReason}` : ""}`,
        callDurationSeconds: null,
        callOutcome: null,
        actorUserId: context.user!.id,
      },
      tx,
    );
    return { lead: updated, fromStatus: existing.status };
  });

  await auditLeadStatusChanged(context, organizationId, input.leadId, fromStatus, input.status);
  if (input.status === "CONVERTED") await auditLeadConverted(context, organizationId, input.leadId);
  return lead;
}
