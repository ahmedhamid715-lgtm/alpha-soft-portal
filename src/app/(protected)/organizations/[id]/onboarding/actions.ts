"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { advanceOnboardingStep } from "@/server/services/organization-management-service";
import { createInvitation } from "@/server/services/invitation-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface OnboardingActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
}

const advanceSchema = z.object({ organizationId: z.string().uuid() });

/**
 * Advances the onboarding step (spec section 27). Every real check —
 * `organizations.update`, the actual state-machine transition — lives in
 * `advanceOnboardingStep()`; this action only shapes the form data,
 * revalidates the page that reads onboarding state, and redirects once
 * the flow reaches its final step, so a completed onboarding never
 * lingers on its own page.
 */
export async function advanceOnboardingAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const parsed = safeParseResult(advanceSchema, { organizationId: formData.get("organizationId") });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  let completed = false;
  try {
    const updated = await advanceOnboardingStep({ organizationId: parsed.data.organizationId });
    completed = !!updated.completedAt;
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/onboarding`);
  if (completed) {
    revalidatePath(`/organizations/${parsed.data.organizationId}`);
    redirect(`/organizations/${parsed.data.organizationId}`);
  }
  return { success: true };
}

const quickInviteSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email(),
  roleId: z.string().uuid(),
});

export async function onboardingQuickInviteAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const parsed = safeParseResult(quickInviteSchema, {
    organizationId: formData.get("organizationId"),
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await createInvitation({ organizationId: parsed.data.organizationId, email: parsed.data.email, roleId: parsed.data.roleId });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/onboarding`);
  return { success: true };
}
