"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPlan, createPlanPrice, updatePlan, updatePlanPrice } from "@/server/services/plan-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface PlanActionState {
  error?: string;
  success?: boolean;
}

const createPlanSchema = z.object({
  key: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export async function createPlanAction(_prevState: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const parsed = safeParseResult(createPlanSchema, { key: formData.get("key"), name: formData.get("name"), description: formData.get("description") || undefined });
  if (!parsed.success) return { error: "Invalid plan." };

  try {
    await createPlan(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/plans");
  return { success: true };
}

const createPriceSchema = z.object({
  planId: z.string().uuid(),
  currency: z.string().length(3),
  unitAmountMajor: z.coerce.number().nonnegative(),
  interval: z.enum(["MONTH", "YEAR"]),
  providerPriceId: z.string().optional(),
});

export async function createPlanPriceAction(_prevState: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const parsed = safeParseResult(createPriceSchema, {
    planId: formData.get("planId"),
    currency: formData.get("currency"),
    unitAmountMajor: formData.get("unitAmountMajor"),
    interval: formData.get("interval"),
    providerPriceId: formData.get("providerPriceId") || undefined,
  });
  if (!parsed.success) return { error: "Invalid price." };

  try {
    await createPlanPrice(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/plans");
  return { success: true };
}

const toggleSchema = z.object({ id: z.string().uuid(), active: z.enum(["true", "false"]) });

export async function togglePlanActiveAction(_prevState: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const parsed = safeParseResult(toggleSchema, { id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await updatePlan({ id: parsed.data.id, active: parsed.data.active === "true" });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/plans");
  return { success: true };
}

export async function togglePlanPriceActiveAction(_prevState: PlanActionState, formData: FormData): Promise<PlanActionState> {
  const parsed = safeParseResult(toggleSchema, { id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await updatePlanPrice({ id: parsed.data.id, active: parsed.data.active === "true" });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/plans");
  return { success: true };
}
