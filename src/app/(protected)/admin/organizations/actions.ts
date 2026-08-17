"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reactivateOrganization } from "@/server/services/organization-management-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

/**
 * The platform admin organization view's own action — reuses
 * `reactivateOrganization()` (`organization-management-service.ts`,
 * Module 07) verbatim, the SAME chokepoint
 * `/organizations/[id]/settings`'s `LifecycleControls` already calls.
 * This is a second UI entry point into that one function — the real
 * reason it exists at all, per `organization-lifecycle.md` "The
 * reactivation reachability gap" — never a second implementation.
 */

export interface OrganizationPlatformActionState {
  error?: string;
  success?: boolean;
}

const organizationIdSchema = z.object({ organizationId: z.string().uuid() });

export async function reactivateOrganizationPlatformAction(
  _prevState: OrganizationPlatformActionState,
  formData: FormData,
): Promise<OrganizationPlatformActionState> {
  const parsed = safeParseResult(organizationIdSchema, { organizationId: formData.get("organizationId") });
  if (!parsed.success) return { error: "Invalid organization." };

  try {
    await reactivateOrganization(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/admin/organizations/${parsed.data.organizationId}`);
  revalidatePath("/admin/organizations");
  return { success: true };
}
