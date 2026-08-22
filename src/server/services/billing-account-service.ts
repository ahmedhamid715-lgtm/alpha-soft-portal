import "server-only";
import { z } from "zod";
import type { BillingAccount } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { audit } from "@/lib/audit/service";
import { logger } from "@/lib/logging";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import { BillingAccountInvalidError } from "@/lib/billing/errors";

/**
 * `BillingAccount` — the organization's commercial relationship (spec
 * §5). Lazily created (see schema.prisma's own doc comment): most
 * organizations have none until their first checkout.
 */

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** `billing.read` — owner + admin. Returns `null`, not a 404 — "no billing account yet" is a normal, expected state (spec §5). */
export async function getBillingAccount(rawInput: unknown): Promise<BillingAccount | null> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  return withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => billingAccountRepository.findByOrganizationId(input.organizationId, tx),
  );
}

/**
 * Idempotent get-or-create — the ONE place a `BillingAccount` row and
 * its Stripe customer come into existence (spec §5: "Do not allow
 * billing-account creation through arbitrary client-supplied
 * organization IDs" — `organizationId` here is always the ALREADY-
 * VERIFIED id from `requirePermission()`'s resolved context, in every
 * real caller, never a raw request field). Called from
 * `subscription-service.ts`'s checkout flow, not exposed as its own
 * mutation surface — creating a billing account with no intent to
 * subscribe to anything has no real use case in this module.
 */
export async function getOrCreateBillingAccount(organizationId: string, actorUserId: string, isPlatformStaff: boolean): Promise<BillingAccount> {
  const existing = await withTenantContext({ userId: actorUserId, organizationId, isPlatformStaff }, (tx) =>
    billingAccountRepository.findByOrganizationId(organizationId, tx),
  );
  if (existing) {
    if (existing.status === "CLOSED") {
      throw new BillingAccountInvalidError("This organization's billing account is closed.");
    }
    return existing;
  }

  const organization = await organizationRepository.findById(organizationId);
  if (!organization) throw new BillingAccountInvalidError("Organization not found.");

  const { providerCustomerId } = await stripeBillingProvider.createCustomer({
    organizationId,
    email: organization.primaryEmail,
    name: organization.displayName,
  });

  const id = generateId();
  const created = await withTenantContext({ userId: actorUserId, organizationId, isPlatformStaff }, async (tx) => {
    const row = await billingAccountRepository.create(
      { id, organizationId, currency: organization.currency, provider: "STRIPE", providerCustomerId },
      tx,
    );
    await audit.recordSuccess({
      action: "billing.account.created",
      organizationId,
      resourceType: "billing_account",
      resourceId: row.id,
      newState: { status: row.status, currency: row.currency, provider: row.provider },
      tx,
    });
    return row;
  });

  logger.info("Billing account created.", { operation: "billing.account.create", organizationId, billingAccountId: created.id });
  return created;
}

const updateStatusSchema = z.object({ organizationId: z.string().uuid(), status: z.enum(["ACTIVE", "PAST_DUE", "SUSPENDED", "CLOSED"]) });

/**
 * Platform-only (spec §5/§24: suspend/close an organization's billing
 * standing). Deliberately gated by `billing.refund`, not
 * `billing.readPlatform` (support_admin's own ceiling) or
 * `billing.plan.manage` (platform_admin's) — rather than inventing a
 * fourth platform-scope billing key for one rare action, this reuses
 * the one permission already reserved for "genuinely moves the needle
 * on a customer's financial standing, platform_owner-only" (see
 * billing-security.md's three-tier reasoning).
 */
export async function updateBillingAccountStatus(rawInput: unknown): Promise<BillingAccount> {
  const input = parseOrThrow(updateStatusSchema, rawInput);
  const context = await requirePermission("billing.refund");

  const account = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    billingAccountRepository.findByOrganizationId(input.organizationId, tx),
  );
  if (!account) throw new BillingAccountInvalidError("This organization has no billing account.");

  const updated = await withTenantContext({ userId: context.user!.id, organizationId: null, isPlatformStaff: true }, async (tx) => {
    const row = await billingAccountRepository.updateStatus(account.id, input.status, tx);
    await audit.recordSuccess({
      action: "billing.account.updated",
      organizationId: input.organizationId,
      resourceType: "billing_account",
      resourceId: row.id,
      previousState: { status: account.status },
      newState: { status: row.status },
      tx,
    });
    return row;
  });

  logger.info("Billing account status updated.", {
    operation: "billing.account.update_status",
    organizationId: input.organizationId,
    billingAccountId: updated.id,
    status: updated.status,
  });
  return updated;
}
