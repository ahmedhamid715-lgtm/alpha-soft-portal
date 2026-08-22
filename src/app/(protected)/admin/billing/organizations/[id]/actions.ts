"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { issueRefund } from "@/server/services/refund-service";
import { issueCredit, extendTrial } from "@/server/services/credit-service";
import { reconcileOrganizationBilling, type OrganizationReconciliationResult } from "@/server/services/billing-reconciliation-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import { toMinorUnits } from "@/lib/utils/money";

export interface RefundActionState {
  error?: string;
  success?: boolean;
}

const refundSchema = z.object({
  organizationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

/**
 * Platform-only refund (spec §13/§22) — `issueRefund()` itself enforces
 * `billing.refund` (platform_owner-only, see roles.ts); this action only
 * shapes the form submission. Always a FULL refund from this admin
 * surface (no partial-amount field) — a deliberate simplification, not
 * a limitation of the underlying service (which does support a partial
 * `amount`); see billing-security.md.
 */
export async function issueRefundAction(_prevState: RefundActionState, formData: FormData): Promise<RefundActionState> {
  const parsed = safeParseResult(refundSchema, {
    organizationId: formData.get("organizationId"),
    paymentId: formData.get("paymentId"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await issueRefund(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/admin/billing/organizations/${parsed.data.organizationId}`);
  return { success: true };
}

const issueCreditSchema = z.object({
  organizationId: z.string().uuid(),
  // The human-entered MAJOR-unit amount (e.g. "49.00") — converted to
  // minor units below via the one shared `toMinorUnits()` boundary
  // (spec §31/§45: no float arithmetic scattered across call sites,
  // never trust a client-computed minor-unit amount).
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
  reason: z.string().min(1).max(500),
});

export interface CreditActionState {
  error?: string;
  success?: boolean;
}

/** Platform-only credit issuance (spec §6/§11) — `issueCredit()` itself enforces `billing.credit.manage` (platform_admin+); this action only shapes the form submission and does the one major→minor unit conversion. */
export async function issueCreditAction(_prevState: CreditActionState, formData: FormData): Promise<CreditActionState> {
  const parsed = safeParseResult(issueCreditSchema, {
    organizationId: formData.get("organizationId"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: "Invalid credit request." };

  try {
    await issueCredit({
      organizationId: parsed.data.organizationId,
      amount: toMinorUnits(parsed.data.amount, parsed.data.currency),
      currency: parsed.data.currency,
      reason: parsed.data.reason,
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/admin/billing/organizations/${parsed.data.organizationId}`);
  return { success: true };
}

const extendTrialSchema = z.object({
  organizationId: z.string().uuid(),
  additionalDays: z.coerce.number().int().min(1).max(90),
  reason: z.string().min(1).max(500),
});

export interface TrialActionState {
  error?: string;
  success?: boolean;
}

/** Platform-only trial extension (spec §6/§16) — `extendTrial()` itself enforces `billing.credit.manage` and rejects a non-TRIALING subscription; only ever writes the new trial end via the provider + webhook reconciliation, never locally (see `credit-service.ts`'s own top comment). */
export async function extendTrialAction(_prevState: TrialActionState, formData: FormData): Promise<TrialActionState> {
  const parsed = safeParseResult(extendTrialSchema, {
    organizationId: formData.get("organizationId"),
    additionalDays: formData.get("additionalDays"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: "Invalid trial extension request." };

  try {
    await extendTrial(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/admin/billing/organizations/${parsed.data.organizationId}`);
  return { success: true };
}

export interface ReconciliationActionState {
  error?: string;
  result?: OrganizationReconciliationResult;
}

/**
 * Called directly (awaited), not through `useActionState` — this is
 * read-only (spec §39: "detect, never silently auto-repair") and the
 * caller needs the returned divergence report to render, not just an
 * error/success flag.
 */
export async function reconcileOrganizationBillingAction(organizationId: string): Promise<ReconciliationActionState> {
  const parsed = safeParseResult(z.object({ organizationId: z.string().uuid() }), { organizationId });
  if (!parsed.success) return { error: "Invalid organization." };

  try {
    const result = await reconcileOrganizationBilling(parsed.data);
    return { result };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
