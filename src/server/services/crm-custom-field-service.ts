import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmCustomFieldDefinitionRepository } from "@/server/repositories/crm-custom-field-definition-repository";
import { crmCustomFieldValueRepository, type CrmCustomFieldValueInput } from "@/server/repositories/crm-custom-field-value-repository";
import { crmLeadRepository } from "@/server/repositories/crm-lead-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmContactRepository } from "@/server/repositories/crm-contact-repository";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { CrmCustomFieldDefinition, CrmCustomFieldEntityType, CrmCustomFieldType, CrmCustomFieldValue } from "@/generated/prisma/client";

/**
 * CRM custom fields — Roadmap 13's own bounded scope: extra fields on a
 * lead/company/contact ("industry vertical," "deal size band"), never
 * the global cross-module Custom Fields Engine (Roadmap 64) — see
 * crm-architecture.md "CRM custom-field boundary." `crm.manage` for
 * defining fields and setting values, `crm.read` for reading them back.
 * Not separately audited (settings-style CRUD, the same reasoning
 * `crm-lead-source-service.ts` already documents).
 */

const createDefinitionSchema = z.object({
  entityType: z.enum(["LEAD", "COMPANY", "CONTACT"]),
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "key must be lower_snake_case."),
  label: z.string().min(1).max(200),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"]),
  options: z.array(z.string().min(1).max(200)).max(50).optional(),
});

export async function createCustomFieldDefinition(rawInput: unknown): Promise<CrmCustomFieldDefinition> {
  const input = parseOrThrow(createDefinitionSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  if (input.fieldType === "SELECT" && (!input.options || input.options.length === 0)) {
    throw new ValidationError("options is required for a SELECT field.");
  }

  const id = generateId();
  return withTenantContext(tenantScope, (tx) =>
    crmCustomFieldDefinitionRepository.create(
      { id, organizationId, entityType: input.entityType, key: input.key, label: input.label, fieldType: input.fieldType, options: input.options },
      tx,
    ),
  );
}

const listDefinitionsSchema = z.object({ entityType: z.enum(["LEAD", "COMPANY", "CONTACT"]).optional() });

export async function listCustomFieldDefinitions(rawInput: unknown): Promise<CrmCustomFieldDefinition[]> {
  const input = parseOrThrow(listDefinitionsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");

  return withTenantContext(tenantScope, (tx) => crmCustomFieldDefinitionRepository.listForOrganization(organizationId, input.entityType, tx));
}

const updateDefinitionSchema = z.object({
  definitionId: z.string().uuid(),
  label: z.string().min(1).max(200).optional(),
  options: z.array(z.string().min(1).max(200)).max(50).optional(),
  isActive: z.boolean().optional(),
});

export async function updateCustomFieldDefinition(rawInput: unknown): Promise<CrmCustomFieldDefinition> {
  const input = parseOrThrow(updateDefinitionSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmCustomFieldDefinitionRepository.findById(input.definitionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Custom field definition");
    const { definitionId, ...data } = input;
    return crmCustomFieldDefinitionRepository.update(definitionId, data, tx);
  });
}

const valueInputSchema = z.object({
  valueText: z.string().max(4000).nullable().optional(),
  valueNumber: z.union([z.number(), z.string()]).nullable().optional(),
  valueDate: z.coerce.date().nullable().optional(),
  valueBoolean: z.boolean().nullable().optional(),
});

function toValueInput(raw: z.infer<typeof valueInputSchema>): CrmCustomFieldValueInput {
  return {
    valueText: raw.valueText ?? null,
    valueNumber: raw.valueNumber === undefined || raw.valueNumber === null ? null : String(raw.valueNumber),
    valueDate: raw.valueDate ?? null,
    valueBoolean: raw.valueBoolean ?? null,
  };
}

// `Decimal(20, 4)` (schema.prisma) — at most 16 integral digits, exactly
// up to 4 fractional digits. A bare-minus sign and leading zeros are
// allowed; scientific notation, `Infinity`/`NaN`, and anything else are
// not — Zod's `z.union([z.number(), z.string()])` alone lets all of
// those through as far as `NUMBER`, DAte, etc. are concerned.
const DECIMAL_20_4_PATTERN = /^-?\d{1,16}(\.\d{1,4})?$/;

/**
 * `definition` (not just `fieldType`) — SELECT membership and NUMBER
 * precision both need more than the field's type to validate. Confirmed
 * by Codex's own Phase 5 security review (Build 19): the previous
 * version only checked WHICH value column was populated, never that a
 * SELECT's text was one of `definition.options`, nor that a NUMBER's
 * input was actually a finite, in-range decimal.
 */
function assertValueMatchesFieldType(definition: { fieldType: CrmCustomFieldType; options: unknown }, value: z.infer<typeof valueInputSchema>): void {
  const provided = ["valueText", "valueNumber", "valueDate", "valueBoolean"].filter((k) => value[k as keyof typeof value] !== undefined && value[k as keyof typeof value] !== null);
  if (provided.length > 1) throw new ValidationError("Only one value field may be set.");
  const expected: Record<CrmCustomFieldType, string | null> = { TEXT: "valueText", SELECT: "valueText", NUMBER: "valueNumber", DATE: "valueDate", BOOLEAN: "valueBoolean" };
  if (provided.length === 1 && provided[0] !== expected[definition.fieldType]) {
    throw new ValidationError(`A ${definition.fieldType} field expects ${expected[definition.fieldType]}.`);
  }

  if (definition.fieldType === "SELECT" && value.valueText != null) {
    const options = Array.isArray(definition.options) ? definition.options.filter((o): o is string => typeof o === "string") : [];
    if (!options.includes(value.valueText)) {
      throw new ValidationError(`"${value.valueText}" is not one of this field's configured options.`);
    }
  }

  if (definition.fieldType === "NUMBER" && value.valueNumber != null) {
    const asString = String(value.valueNumber);
    if (typeof value.valueNumber === "number" && !Number.isFinite(value.valueNumber)) {
      throw new ValidationError("valueNumber must be a finite number.");
    }
    if (!DECIMAL_20_4_PATTERN.test(asString)) {
      throw new ValidationError("valueNumber must be a decimal with at most 16 integer digits and 4 fractional digits.");
    }
  }
}

const setValueSchema = z.object({ definitionId: z.string().uuid() }).and(
  z
    .object({ leadId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), contactId: z.string().uuid().optional() })
    .refine((v) => [v.leadId, v.companyId, v.contactId].filter(Boolean).length === 1, { message: "Exactly one of leadId, companyId, or contactId is required." }),
).and(valueInputSchema);

export async function setCustomFieldValue(rawInput: unknown): Promise<CrmCustomFieldValue> {
  const input = parseOrThrow(setValueSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const definition = await crmCustomFieldDefinitionRepository.findById(input.definitionId, tx);
    if (!definition || definition.organizationId !== organizationId) throw new NotFoundError("Custom field definition");
    assertValueMatchesFieldType(definition, input);

    const expectedEntityType: Record<CrmCustomFieldEntityType, "leadId" | "companyId" | "contactId"> = { LEAD: "leadId", COMPANY: "companyId", CONTACT: "contactId" };
    const targetKey = expectedEntityType[definition.entityType];
    if (!input[targetKey]) throw new ValidationError(`This field applies to ${definition.entityType.toLowerCase()} records only.`);

    const value = toValueInput(input);
    if (input.leadId) {
      const lead = await crmLeadRepository.findById(input.leadId, tx);
      if (!lead || lead.organizationId !== organizationId) throw new ValidationError("leadId does not reference a valid lead.");
      return crmCustomFieldValueRepository.upsertForLead(input.definitionId, input.leadId, value, tx);
    }
    if (input.companyId) {
      const company = await crmCompanyRepository.findById(input.companyId, tx);
      if (!company || company.organizationId !== organizationId) throw new ValidationError("companyId does not reference a valid company.");
      return crmCustomFieldValueRepository.upsertForCompany(input.definitionId, input.companyId, value, tx);
    }
    const contact = await crmContactRepository.findById(input.contactId!, tx);
    if (!contact || contact.organizationId !== organizationId) throw new ValidationError("contactId does not reference a valid contact.");
    return crmCustomFieldValueRepository.upsertForContact(input.definitionId, input.contactId!, value, tx);
  });
}

const listValuesForLeadSchema = z.object({ leadId: z.string().uuid() });

export async function listCustomFieldValuesForLead(rawInput: unknown): Promise<CrmCustomFieldValue[]> {
  const input = parseOrThrow(listValuesForLeadSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  return withTenantContext(tenantScope, async (tx) => {
    const lead = await crmLeadRepository.findById(input.leadId, tx);
    if (!lead || lead.organizationId !== organizationId) throw new NotFoundError("Lead");
    return crmCustomFieldValueRepository.listForLead(input.leadId, tx);
  });
}

const listValuesForCompanySchema = z.object({ companyId: z.string().uuid() });

export async function listCustomFieldValuesForCompany(rawInput: unknown): Promise<CrmCustomFieldValue[]> {
  const input = parseOrThrow(listValuesForCompanySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  return withTenantContext(tenantScope, async (tx) => {
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new NotFoundError("Company");
    return crmCustomFieldValueRepository.listForCompany(input.companyId, tx);
  });
}

const listValuesForContactSchema = z.object({ contactId: z.string().uuid() });

export async function listCustomFieldValuesForContact(rawInput: unknown): Promise<CrmCustomFieldValue[]> {
  const input = parseOrThrow(listValuesForContactSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  return withTenantContext(tenantScope, async (tx) => {
    const contact = await crmContactRepository.findById(input.contactId, tx);
    if (!contact || contact.organizationId !== organizationId) throw new NotFoundError("Contact");
    return crmCustomFieldValueRepository.listForContact(input.contactId, tx);
  });
}
