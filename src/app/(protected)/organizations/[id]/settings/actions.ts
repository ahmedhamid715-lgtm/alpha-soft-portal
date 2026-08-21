"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  updateOrganizationProfile,
  suspendOrganization,
  reactivateOrganization,
  archiveOrganization,
} from "@/server/services/organization-management-service";
import { transferOwnership } from "@/server/services/ownership-transfer-service";
import { updateInvitationPolicy } from "@/server/services/organization-security-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface SettingsActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
}

const profileSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().min(1).max(200).optional(),
  industry: z.string().max(100).optional(),
  website: z.string().url().optional().or(z.literal("")),
  country: z.string().length(2).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  primaryEmail: z.string().email().optional().or(z.literal("")),
});

/** Organization profile self-service (spec section 4/6) — every real check (`organizations.update`, slug/uniqueness) lives in `updateOrganizationProfile()`; this action only shapes the form. */
export async function updateProfileAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = safeParseResult(profileSchema, {
    organizationId: formData.get("organizationId"),
    displayName: formData.get("displayName") || undefined,
    industry: formData.get("industry") || undefined,
    website: formData.get("website") ?? "",
    country: formData.get("country") ?? "",
    phone: formData.get("phone") || undefined,
    primaryEmail: formData.get("primaryEmail") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  const { organizationId, ...rest } = parsed.data;
  try {
    await updateOrganizationProfile({
      organizationId,
      ...(rest.displayName ? { displayName: rest.displayName } : {}),
      ...(rest.industry ? { industry: rest.industry } : {}),
      ...(rest.website ? { website: rest.website } : {}),
      ...(rest.country ? { country: rest.country } : {}),
      ...(rest.phone ? { phone: rest.phone } : {}),
      ...(rest.primaryEmail ? { primaryEmail: rest.primaryEmail } : {}),
    });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${organizationId}/settings`);
  revalidatePath(`/organizations/${organizationId}`);
  return { success: true };
}

const lifecycleSchema = z.object({ organizationId: z.string().uuid() });

async function runLifecycleAction(
  formData: FormData,
  fn: (input: { organizationId: string }) => Promise<unknown>,
): Promise<SettingsActionState> {
  const parsed = safeParseResult(lifecycleSchema, { organizationId: formData.get("organizationId") });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await fn(parsed.data);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/settings`);
  revalidatePath(`/organizations/${parsed.data.organizationId}`);
  revalidatePath("/organizations");
  return { success: true };
}

export async function suspendOrganizationAction(_prevState: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  return runLifecycleAction(formData, suspendOrganization);
}

export async function reactivateOrganizationAction(_prevState: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  return runLifecycleAction(formData, reactivateOrganization);
}

export async function archiveOrganizationAction(_prevState: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  return runLifecycleAction(formData, archiveOrganization);
}

const transferSchema = z.object({ organizationId: z.string().uuid(), toMembershipId: z.string().uuid() });

/**
 * Ownership transfer (spec sections 20/21/34/46) — `fromMembershipId` is
 * deliberately never a field here; `transferOwnership()` derives it
 * server-side from the caller's own verified membership, never from
 * anything this form could submit.
 */
export async function transferOwnershipAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = safeParseResult(transferSchema, {
    organizationId: formData.get("organizationId"),
    toMembershipId: formData.get("toMembershipId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await transferOwnership(parsed.data);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/settings`);
  revalidatePath(`/organizations/${parsed.data.organizationId}/members`);
  revalidatePath(`/organizations/${parsed.data.organizationId}`);
  return { success: true };
}

/** Splits a textarea's newline/comma-separated lines into a raw string array — normalization/validation itself is `organization-security-service.ts`'s job, not this form's. */
function splitDomainListInput(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const invitationPolicySchema = z.object({
  organizationId: z.string().uuid(),
  requireOwnerForInvitations: z.boolean(),
  allowedDomains: z.array(z.string()),
  blockedDomains: z.array(z.string()),
  invitationExpiryHours: z.coerce.number().int(),
});

/** Owner-only (`organizations.security.update` — enforced inside `updateInvitationPolicy()`, not here; this form only shapes the submission). */
export async function updateInvitationPolicyAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = safeParseResult(invitationPolicySchema, {
    organizationId: formData.get("organizationId"),
    requireOwnerForInvitations: formData.get("requireOwnerForInvitations") === "on",
    allowedDomains: splitDomainListInput(formData.get("allowedDomains")),
    blockedDomains: splitDomainListInput(formData.get("blockedDomains")),
    invitationExpiryHours: formData.get("invitationExpiryHours") || 168,
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await updateInvitationPolicy(parsed.data);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/settings`);
  return { success: true };
}
