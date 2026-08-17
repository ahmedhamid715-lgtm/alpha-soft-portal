"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notificationService } from "@/lib/notifications/service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface PreferenceActionState {
  error?: string;
  success?: boolean;
}

const schema = z.object({
  category: z.string().min(1),
  channel: z.enum(["IN_APP", "EMAIL", "SMS", "PUSH"]),
  enabled: z.enum(["true", "false"]),
});

/**
 * Every real check — identity ownership, the mandatory-channel rejection
 * — lives in `notificationService.updatePreference()` (spec section 13:
 * "server-side enforcement must match the UI"). This action only parses
 * the form and revalidates the page; it is not a second place that
 * decides what's mandatory.
 */
export async function updatePreferenceAction(_prevState: PreferenceActionState, formData: FormData): Promise<PreferenceActionState> {
  const parsed = safeParseResult(schema, {
    category: formData.get("category"),
    channel: formData.get("channel"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) return { error: "Invalid preference." };

  try {
    await notificationService.updatePreference({
      category: parsed.data.category,
      channel: parsed.data.channel,
      enabled: parsed.data.enabled === "true",
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/settings/notifications");
  return { success: true };
}
