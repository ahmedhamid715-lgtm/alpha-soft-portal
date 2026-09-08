import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmProposalTemplateRepository } from "@/server/repositories/crm-proposal-template-repository";
import { sanitizeProposalHtml } from "@/lib/crm/sanitize-proposal-html";
import { NotFoundError } from "@/lib/errors/app-error";
import type { CrmProposalTemplate } from "@/generated/prisma/client";

/**
 * Proposal template CRUD (Build 22) — tenant-owned starting content for
 * a new proposal only. Deliberately NOT a document CMS: no versioning,
 * no approval workflow of its own, no line items (see the model's own
 * schema comment). Same `crm.proposal.manage`/`crm.proposal.read`
 * permissions as proposals themselves — templates are a proposal-authoring
 * convenience, not a separate resource requiring its own grant.
 */

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  defaultTitle: z.string().min(1).max(200),
  defaultBodyHtml: z.string().max(200_000),
  defaultTermsHtml: z.string().max(200_000).nullable().optional(),
  defaultValidityDays: z.number().int().min(1).max(3650).default(30),
});

export async function createProposalTemplate(rawInput: unknown): Promise<CrmProposalTemplate> {
  const input = parseOrThrow(createTemplateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  return withTenantContext(tenantScope, (tx) =>
    crmProposalTemplateRepository.create(
      {
        id: generateId(),
        organizationId,
        name: input.name,
        defaultTitle: input.defaultTitle,
        defaultBodyHtml: sanitizeProposalHtml(input.defaultBodyHtml),
        defaultTermsHtml: input.defaultTermsHtml ? sanitizeProposalHtml(input.defaultTermsHtml) : null,
        defaultValidityDays: input.defaultValidityDays,
      },
      tx,
    ),
  );
}

const listTemplatesSchema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });

export async function listProposalTemplates(rawInput: unknown): Promise<CrmProposalTemplate[]> {
  const input = parseOrThrow(listTemplatesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.read");
  return withTenantContext(tenantScope, (tx) => crmProposalTemplateRepository.listForOrganization(organizationId, input.status, tx));
}

const getTemplateSchema = z.object({ templateId: z.string().uuid() });

export async function getProposalTemplate(rawInput: unknown): Promise<CrmProposalTemplate> {
  const input = parseOrThrow(getTemplateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.read");
  const template = await withTenantContext(tenantScope, (tx) => crmProposalTemplateRepository.findById(input.templateId, tx));
  if (!template || template.organizationId !== organizationId) throw new NotFoundError("Proposal template");
  return template;
}

const updateTemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  defaultTitle: z.string().min(1).max(200).optional(),
  defaultBodyHtml: z.string().max(200_000).optional(),
  defaultTermsHtml: z.string().max(200_000).nullable().optional(),
  defaultValidityDays: z.number().int().min(1).max(3650).optional(),
});

export async function updateProposalTemplate(rawInput: unknown): Promise<CrmProposalTemplate> {
  const input = parseOrThrow(updateTemplateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmProposalTemplateRepository.findById(input.templateId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Proposal template");
    const { templateId, ...data } = input;
    void templateId;
    return crmProposalTemplateRepository.update(
      input.templateId,
      { ...data, defaultBodyHtml: data.defaultBodyHtml ? sanitizeProposalHtml(data.defaultBodyHtml) : undefined, defaultTermsHtml: data.defaultTermsHtml !== undefined ? (data.defaultTermsHtml ? sanitizeProposalHtml(data.defaultTermsHtml) : null) : undefined },
      tx,
    );
  });
}

const archiveTemplateSchema = z.object({ templateId: z.string().uuid() });

export async function archiveProposalTemplate(rawInput: unknown): Promise<CrmProposalTemplate> {
  const input = parseOrThrow(archiveTemplateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmProposalTemplateRepository.findById(input.templateId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Proposal template");
    return crmProposalTemplateRepository.setStatus(input.templateId, "ARCHIVED", tx);
  });
}

export async function reactivateProposalTemplate(rawInput: unknown): Promise<CrmProposalTemplate> {
  const input = parseOrThrow(archiveTemplateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmProposalTemplateRepository.findById(input.templateId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Proposal template");
    return crmProposalTemplateRepository.setStatus(input.templateId, "ACTIVE", tx);
  });
}
