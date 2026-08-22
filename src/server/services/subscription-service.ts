import "server-only";
import { z } from "zod";
import type { Subscription } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { events } from "@/lib/platform/events";
import { logger } from "@/lib/logging";
import { appConfig } from "@/config/app";
import { audit } from "@/lib/audit/service";
import { subscriptionRepository, subscriptionItemRepository } from "@/server/repositories/subscription-repository";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { getOrCreateBillingAccount } from "./billing-account-service";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import { BillingAccountInvalidError, PlanPriceNotFoundError, SubscriptionChangeRejectedError } from "@/lib/billing/errors";

/**
 * Subscription lifecycle (spec §8/§26/§28) — every mutation here does
 * exactly ONE thing: call the provider and record the caller's INTENT.
 * The actual resulting subscription STATE (status, current period,
 * items) is never written by these functions — that's
 * `billing-webhook-service.ts`'s job, reconciling what Stripe actually
 * did (spec §21/§44: "never treat a browser redirect as proof of
 * successful payment," "a user action calls the provider; a provider
 * event is what actually changes state").
 */

const startCheckoutSchema = z.object({ organizationId: z.string().uuid(), planPriceId: z.string().uuid() });

/**
 * Starts (or changes to) a subscription via Stripe Checkout (spec §25:
 * "prefer Stripe Checkout... do not build a raw card-entry system").
 * The server derives the ACTUAL price from the internal catalog —
 * `planPriceId` is the only thing the client submits; the provider price
 * id, amount, and currency are all resolved server-side (spec §26/§43:
 * "never accept `amount` from a customer to determine what they pay").
 */
export async function startCheckoutForPlanPrice(rawInput: unknown): Promise<{ url: string }> {
  const input = parseOrThrow(startCheckoutSchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const price = await planPriceRepository.findById(input.planPriceId);
  if (!price || !price.active) throw new PlanPriceNotFoundError();
  if (!price.providerPriceId) {
    throw new SubscriptionChangeRejectedError("This plan price is not yet available for purchase.");
  }

  const account = await getOrCreateBillingAccount(input.organizationId, context.user!.id, context.isPlatformStaff);
  if (account.status === "SUSPENDED" || account.status === "CLOSED") {
    throw new BillingAccountInvalidError(`This organization's billing account is ${account.status.toLowerCase()} and cannot start a new subscription.`);
  }
  if (price.currency !== account.currency) {
    throw new SubscriptionChangeRejectedError("This plan price's currency does not match the organization's billing currency.");
  }

  const result = await stripeBillingProvider.createCheckoutSession({
    organizationId: input.organizationId,
    providerCustomerId: account.providerCustomerId,
    planPriceId: price.id,
    providerPriceId: price.providerPriceId,
    quantity: 1,
    successUrl: `${appConfig.url}/organizations/${input.organizationId}/billing?checkout=success`,
    cancelUrl: `${appConfig.url}/organizations/${input.organizationId}/billing?checkout=canceled`,
  });

  logger.info("Checkout session created.", { operation: "billing.checkout.create", organizationId: input.organizationId, planPriceId: price.id });
  return result;
}

const subscriptionActionSchema = z.object({ organizationId: z.string().uuid() });

/** The organization's current subscription — `billing.read`. `null` is a normal state (no subscription yet). */
export async function getCurrentSubscription(rawInput: unknown): Promise<Subscription | null> {
  const input = parseOrThrow(subscriptionActionSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );
}

export interface CurrentSubscriptionDetail {
  subscription: Subscription | null;
  planName: string | null;
  unitAmount: number | null;
  currency: string | null;
  interval: "MONTH" | "YEAR" | null;
}

/** `billing.read` — the composed view the billing dashboard actually renders: subscription + its plan's display name/price, resolved server-side so the UI never has to stitch three lookups together itself. */
export async function getCurrentSubscriptionDetail(rawInput: unknown): Promise<CurrentSubscriptionDetail> {
  const input = parseOrThrow(subscriptionActionSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);

  const subscription = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );
  if (!subscription) return { subscription: null, planName: null, unitAmount: null, currency: null, interval: null };

  const items = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => subscriptionItemRepository.listForSubscription(subscription.id, tx),
  );
  const firstItem = items[0];
  if (!firstItem) return { subscription, planName: null, unitAmount: null, currency: null, interval: null };

  const price = await planPriceRepository.findById(firstItem.planPriceId);
  if (!price) return { subscription, planName: null, unitAmount: null, currency: null, interval: null };
  const plan = await planRepository.findById(price.planId);

  return { subscription, planName: plan?.name ?? null, unitAmount: price.unitAmount, currency: price.currency, interval: price.interval };
}

const cancelSchema = z.object({ organizationId: z.string().uuid(), atPeriodEnd: z.boolean().default(true) });

/**
 * Cancellation (spec §28) — defaults to at-period-end (reversible via
 * `resumeSubscription` below until the period actually ends); immediate
 * cancellation is available but not the default. Never deletes
 * subscription history — the row's `status` transitions, it is never
 * removed (spec §37).
 */
export async function cancelSubscription(rawInput: unknown): Promise<Subscription> {
  const input = parseOrThrow(cancelSchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const subscription = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );
  if (!subscription || !subscription.providerSubscriptionId) {
    throw new SubscriptionChangeRejectedError("This organization has no active subscription to cancel.");
  }
  if (subscription.status === "CANCELED") {
    throw new SubscriptionChangeRejectedError("This subscription is already canceled.");
  }

  await stripeBillingProvider.cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, atPeriodEnd: input.atPeriodEnd });

  // Optimistic, LOCAL-ONLY flag update — never the authoritative status
  // transition (that arrives via `customer.subscription.updated`/
  // `.deleted`, see this file's own top comment). `cancelAtPeriodEnd`
  // is safe to set immediately: it mirrors exactly what was just
  // requested, not a guess about provider-side outcome.
  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const row = input.atPeriodEnd
        ? await subscriptionRepository.setCancelAtPeriodEnd(subscription.id, true, tx)
        : subscription; // immediate cancellation's real status change arrives via webhook only — nothing safe to set optimistically here
      await audit.recordSuccess({
        action: "billing.subscription.canceled",
        organizationId: input.organizationId,
        resourceType: "subscription",
        resourceId: subscription.id,
        newState: { atPeriodEnd: input.atPeriodEnd },
        tx,
      });
      return row;
    },
  );

  logger.info("Subscription cancellation requested.", {
    operation: "billing.subscription.cancel",
    organizationId: input.organizationId,
    subscriptionId: subscription.id,
    atPeriodEnd: input.atPeriodEnd,
  });
  await events.emit("billing.subscription.cancel_requested", { organizationId: input.organizationId, subscriptionId: subscription.id, atPeriodEnd: input.atPeriodEnd });
  return updated;
}

/** Reverses a pending cancel-at-period-end (spec §28: "design for... resume"). Not valid once the subscription has actually reached CANCELED — Stripe itself rejects resuming a subscription that's already ended. */
export async function resumeSubscription(rawInput: unknown): Promise<Subscription> {
  const input = parseOrThrow(subscriptionActionSchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const subscription = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );
  if (!subscription || !subscription.providerSubscriptionId) {
    throw new SubscriptionChangeRejectedError("This organization has no subscription to resume.");
  }
  if (!subscription.cancelAtPeriodEnd) {
    throw new SubscriptionChangeRejectedError("This subscription is not scheduled for cancellation.");
  }

  await stripeBillingProvider.resumeSubscription({ providerSubscriptionId: subscription.providerSubscriptionId });

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const row = await subscriptionRepository.setCancelAtPeriodEnd(subscription.id, false, tx);
      await audit.recordSuccess({
        action: "billing.subscription.updated",
        organizationId: input.organizationId,
        resourceType: "subscription",
        resourceId: subscription.id,
        newState: { cancelAtPeriodEnd: false },
        tx,
      });
      return row;
    },
  );

  logger.info("Subscription resumed.", { operation: "billing.subscription.resume", organizationId: input.organizationId, subscriptionId: subscription.id });
  await events.emit("billing.subscription.resumed", { organizationId: input.organizationId, subscriptionId: subscription.id });
  return updated;
}
