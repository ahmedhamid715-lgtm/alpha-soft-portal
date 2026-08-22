import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { logger } from "@/lib/logging";
import { appConfig } from "@/config/app";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import { BillingAccountInvalidError } from "@/lib/billing/errors";

const schema = z.object({ organizationId: z.string().uuid() });

/**
 * Stripe Billing Portal (spec §25/§51) — payment-method management,
 * invoice history, and billing details, all Stripe-hosted; Alpha OS
 * never builds a raw card form. The organization's `providerCustomerId`
 * is always looked up SERVER-SIDE from its own `BillingAccount` row,
 * gated by `billing.manage` and re-verified through
 * `withTenantContext()` — never a client-supplied Stripe customer id
 * (spec §51: "Never generate a portal session for an arbitrary client-
 * supplied Stripe customer ID" — there is no code path in this file
 * that could even accept one).
 */
export async function createBillingPortalSession(rawInput: unknown): Promise<{ url: string }> {
  const input = parseOrThrow(schema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const account = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => billingAccountRepository.findByOrganizationId(input.organizationId, tx),
  );
  if (!account) throw new BillingAccountInvalidError("This organization has no billing account yet.");

  const result = await stripeBillingProvider.createBillingPortalSession({
    organizationId: input.organizationId,
    providerCustomerId: account.providerCustomerId,
    returnUrl: `${appConfig.url}/organizations/${input.organizationId}/billing`,
  });

  logger.info("Billing portal session created.", { operation: "billing.portal.create", organizationId: input.organizationId });
  return result;
}
