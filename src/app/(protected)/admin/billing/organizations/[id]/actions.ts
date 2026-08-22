"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { issueRefund } from "@/server/services/refund-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

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
