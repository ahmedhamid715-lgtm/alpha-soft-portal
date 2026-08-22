"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { retryInvoicePayment } from "@/server/services/invoice-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface RetryPaymentActionState {
  error?: string;
  success?: boolean;
}

const retrySchema = z.object({ organizationId: z.string().uuid(), invoiceId: z.string().uuid() });

/** `billing.manage` — Stripe's own retry capability for one OPEN invoice, exposed as-is (see `invoice-service.ts`'s own top comment for why this is deliberately not a retry engine). */
export async function retryInvoicePaymentAction(_prevState: RetryPaymentActionState, formData: FormData): Promise<RetryPaymentActionState> {
  const parsed = safeParseResult(retrySchema, { organizationId: formData.get("organizationId"), invoiceId: formData.get("invoiceId") });
  if (!parsed.success) return { error: "Invalid request." };

  try {
    await retryInvoicePayment(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/billing/invoices/${parsed.data.invoiceId}`);
  return { success: true };
}
