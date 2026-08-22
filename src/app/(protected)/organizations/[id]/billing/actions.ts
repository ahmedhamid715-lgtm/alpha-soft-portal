"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { startCheckoutForPlanPrice, cancelSubscription, resumeSubscription } from "@/server/services/subscription-service";
import { createBillingPortalSession } from "@/server/services/billing-portal-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface BillingActionState {
  error?: string;
  success?: boolean;
}

const checkoutSchema = z.object({ organizationId: z.string().uuid(), planPriceId: z.string().uuid() });

/**
 * Starts (or changes to) a subscription (spec §25/§26) — the client
 * submits only `planPriceId`; `startCheckoutForPlanPrice()` derives
 * everything else (real price, provider id, currency) server-side. On
 * success this redirects straight to Stripe Checkout — never renders a
 * local "success" state, since nothing has actually happened yet until
 * the customer completes payment there and the webhook confirms it
 * (spec §44).
 */
export async function startCheckoutAction(_prevState: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const parsed = safeParseResult(checkoutSchema, { organizationId: formData.get("organizationId"), planPriceId: formData.get("planPriceId") });
  if (!parsed.success) return { error: "Invalid plan selection." };

  let url: string;
  try {
    const result = await startCheckoutForPlanPrice(parsed.data);
    url = result.url;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  redirect(url);
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** Stripe Billing Portal (spec §25/§51) — payment method, invoice history, billing details, entirely Stripe-hosted. */
export async function openBillingPortalAction(_prevState: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const parsed = safeParseResult(orgIdSchema, { organizationId: formData.get("organizationId") });
  if (!parsed.success) return { error: "Invalid organization." };

  let url: string;
  try {
    const result = await createBillingPortalSession(parsed.data);
    url = result.url;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  redirect(url);
}

const cancelSchema = z.object({ organizationId: z.string().uuid(), atPeriodEnd: z.enum(["true", "false"]).default("true") });

export async function cancelSubscriptionAction(_prevState: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const parsed = safeParseResult(cancelSchema, { organizationId: formData.get("organizationId"), atPeriodEnd: formData.get("atPeriodEnd") ?? "true" });
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await cancelSubscription({ organizationId: parsed.data.organizationId, atPeriodEnd: parsed.data.atPeriodEnd === "true" });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/billing`);
  return { success: true };
}

export async function resumeSubscriptionAction(_prevState: BillingActionState, formData: FormData): Promise<BillingActionState> {
  const parsed = safeParseResult(orgIdSchema, { organizationId: formData.get("organizationId") });
  if (!parsed.success) return { error: "Invalid organization." };

  try {
    await resumeSubscription(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/billing`);
  return { success: true };
}
