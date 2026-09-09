"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { updateOrganizationProfile } from "@/server/services/organization-management-service";
import { requirePermission } from "@/lib/authorization/authorize";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface PortalCompanyActionState {
  error?: string;
  success?: boolean;
}

const schema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  website: z.string().url().or(z.literal("")),
  industry: z.string().max(100),
  country: z.string().length(2).or(z.literal("")),
  phone: z.string().max(30),
  primaryEmail: z.string().email().or(z.literal("")),
});

const nullIfEmpty = (v: string) => (v === "" ? null : v);

/**
 * "My Company" edit — a thin form-shaping wrapper around the EXISTING
 * `updateOrganizationProfile()` (Module 07), which re-verifies
 * `organizations.update` itself; never a parallel company-profile write
 * path (see customer-portal.md "My Company" — "Do not create parallel
 * company profile storage").
 *
 * Also independently requires `portal.access` (Codex Security Engineer
 * finding, Low) — `organizations.update` alone would let a
 * hypothetical future custom organization role that holds
 * `organizations.update` but was deliberately NOT granted
 * `portal.access` still mutate through this Portal-specific action.
 * Defense in depth: `portal.access` is the floor for the whole Portal
 * surface, and every mutating Portal action should enforce it
 * explicitly, not rely on it merely correlating with the section's own
 * permission today.
 */
export async function updatePortalCompanyProfileAction(_prevState: PortalCompanyActionState, formData: FormData): Promise<PortalCompanyActionState> {
  const parsed = safeParseResult(schema, {
    organizationId: formData.get("organizationId"),
    displayName: formData.get("displayName"),
    website: formData.get("website"),
    industry: formData.get("industry"),
    country: formData.get("country"),
    phone: formData.get("phone"),
    primaryEmail: formData.get("primaryEmail"),
  });
  if (!parsed.success) return { error: "Please check the fields and try again." };

  try {
    await requirePermission("portal.access", parsed.data.organizationId);
    await updateOrganizationProfile({
      organizationId: parsed.data.organizationId,
      displayName: parsed.data.displayName,
      website: nullIfEmpty(parsed.data.website),
      industry: nullIfEmpty(parsed.data.industry),
      country: nullIfEmpty(parsed.data.country),
      phone: nullIfEmpty(parsed.data.phone),
      primaryEmail: nullIfEmpty(parsed.data.primaryEmail),
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/portal/company");
  return { success: true };
}
