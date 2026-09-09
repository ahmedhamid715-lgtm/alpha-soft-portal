"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createBillingPortalSession } from "@/server/services/billing-portal-service";
import { requirePermission } from "@/lib/authorization/authorize";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface PortalBillingActionState {
  error?: string;
}

const schema = z.object({ organizationId: z.string().uuid() });

/**
 * Redirects to the Stripe-hosted Billing Portal — the SAME existing
 * service `/organizations/[id]/billing`'s own button uses
 * (`createBillingPortalSession()`, `billing.manage`). Alpha OS never
 * builds its own card-entry form or a second payment abstraction (see
 * customer-portal.md "Payments"). Also independently requires
 * `portal.access`, same defense-in-depth reasoning as
 * `updatePortalCompanyProfileAction`'s own identical comment.
 */
export async function openPortalBillingPortalAction(_prevState: PortalBillingActionState, formData: FormData): Promise<PortalBillingActionState> {
  const parsed = safeParseResult(schema, { organizationId: formData.get("organizationId") });
  if (!parsed.success) return { error: "Invalid organization." };

  let url: string;
  try {
    await requirePermission("portal.access", parsed.data.organizationId);
    const result = await createBillingPortalSession(parsed.data);
    url = result.url;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  redirect(url);
}
