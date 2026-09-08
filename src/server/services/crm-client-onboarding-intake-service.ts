import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { lockActiveOnboarding } from "./crm-client-onboarding-service";
import { checkReadyForKickoff, emitReadyForKickoffIfAny, type ReadyForKickoffNotification } from "./crm-client-onboarding-checklist-service";
import { crmClientOnboardingIntakeFieldRepository } from "@/server/repositories/crm-client-onboarding-intake-field-repository";
import { crmClientOnboardingIntakeResponseRepository } from "@/server/repositories/crm-client-onboarding-intake-response-repository";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { CrmClientOnboardingIntakeField, CrmClientOnboardingIntakeResponse } from "@/generated/prisma/client";

/**
 * Onboarding intake (Build 23) — a small, tenant-wide, reusable field
 * CATALOG plus per-onboarding responses. Deliberately NOT a generic Forms
 * Builder (no arbitrary/executable schema — see the model's own schema
 * comment). Staff-recorded only in Build 23; no customer self-service
 * intake surface exists yet.
 */

const FIELD_TYPES = ["SHORT_TEXT", "LONG_TEXT", "EMAIL", "PHONE", "URL", "SELECT", "CHECKBOX", "DATE"] as const;

const createFieldSchema = z
  .object({
    label: z.string().min(1).max(200),
    fieldType: z.enum(FIELD_TYPES),
    required: z.boolean().default(true),
    options: z.array(z.string().min(1).max(200)).max(50).optional(),
  })
  .refine((v) => v.fieldType !== "SELECT" || (v.options && v.options.length > 0), { message: "A SELECT field needs at least one option.", path: ["options"] })
  .refine((v) => v.fieldType === "SELECT" || !v.options, { message: "Only a SELECT field may have options.", path: ["options"] });

export async function createIntakeField(rawInput: unknown): Promise<CrmClientOnboardingIntakeField> {
  const input = parseOrThrow(createFieldSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const fields = await crmClientOnboardingIntakeFieldRepository.listForOrganization(organizationId, undefined, tx);
    return crmClientOnboardingIntakeFieldRepository.create(
      { id: generateId(), organizationId, label: input.label, fieldType: input.fieldType, required: input.required, options: input.options ?? null, sortOrder: fields.length },
      tx,
    );
  });
}

const listFieldsSchema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });

export async function listIntakeFields(rawInput: unknown): Promise<CrmClientOnboardingIntakeField[]> {
  const input = parseOrThrow(listFieldsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  return withTenantContext(tenantScope, (tx) => crmClientOnboardingIntakeFieldRepository.listForOrganization(organizationId, input.status, tx));
}

const archiveFieldSchema = z.object({ fieldId: z.string().uuid() });

export async function archiveIntakeField(rawInput: unknown): Promise<CrmClientOnboardingIntakeField> {
  const input = parseOrThrow(archiveFieldSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingIntakeFieldRepository.findById(input.fieldId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Intake field");
    return crmClientOnboardingIntakeFieldRepository.setStatus(input.fieldId, "ARCHIVED", tx);
  });
}

export async function reactivateIntakeField(rawInput: unknown): Promise<CrmClientOnboardingIntakeField> {
  const input = parseOrThrow(archiveFieldSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingIntakeFieldRepository.findById(input.fieldId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Intake field");
    return crmClientOnboardingIntakeFieldRepository.setStatus(input.fieldId, "ACTIVE", tx);
  });
}

/** Type-specific structural validation against the field's own `fieldType` — matches `proposal-pricing.ts`'s own "validate structurally at the application layer" discipline. An empty/whitespace value is treated as "no response" for an optional field, but rejected for a required one. */
function validateResponseValue(field: CrmClientOnboardingIntakeField, rawValue: string | null): string | null {
  const trimmed = rawValue?.trim() ?? "";
  if (trimmed === "") {
    if (field.required) throw new ValidationError(`"${field.label}" is required.`);
    return null;
  }
  switch (field.fieldType) {
    case "EMAIL":
      if (!z.string().email().safeParse(trimmed).success) throw new ValidationError(`"${field.label}" must be a valid email address.`);
      break;
    case "URL":
      if (!z.string().url().safeParse(trimmed).success) throw new ValidationError(`"${field.label}" must be a valid URL.`);
      break;
    case "DATE":
      // A strict ISO 8601 calendar date (Codex Security Engineer finding
      // #7) — `Date.parse()` alone also accepts e.g. "Jan 5" or a full
      // timestamp with an embedded time/timezone, which isn't the shape
      // this field is meant to store (see the response model's own
      // "DATE as an ISO date string" comment). `Date.parse` still backs
      // the actual validity check (rejects "2024-02-30").
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(Date.parse(trimmed))) throw new ValidationError(`"${field.label}" must be a valid date (YYYY-MM-DD).`);
      break;
    case "CHECKBOX":
      if (trimmed !== "true" && trimmed !== "false") throw new ValidationError(`"${field.label}" must be checked or unchecked.`);
      break;
    case "SELECT": {
      const options = Array.isArray(field.options) ? (field.options as unknown[]).filter((o): o is string => typeof o === "string") : [];
      if (!options.includes(trimmed)) throw new ValidationError(`"${field.label}" must be one of its own defined options.`);
      break;
    }
    case "PHONE":
      // Deliberately permissive on formatting (international numbers,
      // extensions, punctuation vary too widely to justify a rigid
      // pattern here — same "don't over-validate free text" restraint
      // this module applies elsewhere) but still rejects obvious
      // non-phone-number input (Codex Security Engineer finding #7 — PHONE
      // previously had no validation at all, silently accepting any
      // string). Requires at least 7 digits and only characters a real
      // phone number could plausibly contain.
      if (!/^[+\d][\d\s().-]{6,}$/.test(trimmed) || trimmed.replace(/\D/g, "").length < 7) throw new ValidationError(`"${field.label}" must be a valid phone number.`);
      break;
    case "SHORT_TEXT":
    case "LONG_TEXT":
      break;
  }
  return trimmed;
}

const recordResponseSchema = z.object({ onboardingId: z.string().uuid(), fieldId: z.string().uuid(), value: z.string().max(4000).nullable() });

export async function recordIntakeResponse(rawInput: unknown): Promise<CrmClientOnboardingIntakeResponse> {
  const input = parseOrThrow(recordResponseSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  let readyForKickoff: ReadyForKickoffNotification | null = null;
  const response = await withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    const field = await crmClientOnboardingIntakeFieldRepository.findById(input.fieldId, tx);
    if (!field || field.organizationId !== organizationId) throw new NotFoundError("Intake field");

    const value = validateResponseValue(field, input.value);
    const created = await crmClientOnboardingIntakeResponseRepository.upsert({ organizationId, onboardingId: input.onboardingId, fieldId: input.fieldId, value, respondedByUserId: context.user!.id }, tx);
    // Recording an intake response is itself a completion-criteria input
    // (Codex Security Engineer finding #8) — without this call, an
    // onboarding whose only remaining unmet gate was a required intake
    // field never fired the ready-for-kickoff notification, since nothing
    // else on this path ever re-evaluated it.
    readyForKickoff = await checkReadyForKickoff(input.onboardingId, organizationId, tx);
    return created;
  });
  // Emitted after commit, not from inside the transaction — see
  // `checkReadyForKickoff()`'s own comment (Codex Performance Engineer
  // review).
  await emitReadyForKickoffIfAny(readyForKickoff);
  return response;
}
