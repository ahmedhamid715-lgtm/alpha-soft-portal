"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateOwnProfile } from "@/server/services/user-profile-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface ProfileActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
}

const profileSchema = z.object({
  name: z.string().min(1).max(200),
  timezone: z.string().max(100).optional(),
  locale: z.string().max(20).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
});

/**
 * Self-service profile only (spec section 24) — `updateOwnProfile()` has
 * no `organizationId` parameter anywhere in its signature; there is
 * nothing this action could send that would touch a membership, a role,
 * or a password hash even if it tried.
 */
export async function updateProfileAction(_prevState: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const parsed = safeParseResult(profileSchema, {
    name: formData.get("name"),
    timezone: formData.get("timezone") || undefined,
    locale: formData.get("locale") || undefined,
    avatarUrl: formData.get("avatarUrl") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await updateOwnProfile({
      name: parsed.data.name,
      ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
      ...(parsed.data.locale ? { locale: parsed.data.locale } : {}),
      ...(parsed.data.avatarUrl ? { avatarUrl: parsed.data.avatarUrl } : {}),
    });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath("/profile");
  return { success: true };
}
