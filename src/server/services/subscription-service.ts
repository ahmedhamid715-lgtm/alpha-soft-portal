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
import { validateSubscriptionTransition } from "@/lib/billing/subscription-state-machine";
import type { TransactionClient } from "@/lib/db/transaction";

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
  planPriceId: string | null;
  unitAmount: number | null;
  currency: string | null;
  interval: "MONTH" | "YEAR" | null;
}

/** `billing.read` — the composed view the billing dashboard actually renders: subscription + its plan's display name/price, resolved server-side so the UI never has to stitch three lookups together itself. `planPriceId` (Module 14) lets the customer's own "change plan" picker exclude the price the organization is already on, without a second round trip. */
export async function getCurrentSubscriptionDetail(rawInput: unknown): Promise<CurrentSubscriptionDetail> {
  const input = parseOrThrow(subscriptionActionSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);

  const subscription = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );
  if (!subscription) return { subscription: null, planName: null, planPriceId: null, unitAmount: null, currency: null, interval: null };

  const items = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => subscriptionItemRepository.listForSubscription(subscription.id, tx),
  );
  const firstItem = items[0];
  if (!firstItem) return { subscription, planName: null, planPriceId: null, unitAmount: null, currency: null, interval: null };

  const price = await planPriceRepository.findById(firstItem.planPriceId);
  if (!price) return { subscription, planName: null, planPriceId: null, unitAmount: null, currency: null, interval: null };
  const plan = await planRepository.findById(price.planId);

  return { subscription, planName: plan?.name ?? null, planPriceId: price.id, unitAmount: price.unitAmount, currency: price.currency, interval: price.interval };
}

const cancelSchema = z.object({ organizationId: z.string().uuid(), atPeriodEnd: z.boolean().default(true) });

/**
 * Cancellation (spec §28) — defaults to at-period-end (reversible via
 * `resumeSubscription` below until the period actually ends); immediate
 * cancellation is available but not the default. Never deletes
 * subscription history — the row's `status` transitions, it is never
 * removed (spec §37).
 */
/**
 * Module 14 — the read-validate-write sequence now happens inside ONE
 * locked transaction (spec §4/§17/§49: "two simultaneous cancellation
 * requests must not [race]... disable duplicate submissions, but do
 * NOT rely on disabled buttons for correctness"). `validateSubscriptionTransition()`
 * (the state-machine chokepoint) runs against the LOCKED row's current
 * state, so a second concurrent cancel request always sees the first
 * one's already-applied result and is correctly rejected as "already
 * canceled" / "already scheduled" rather than racing it. Proven under
 * real concurrency — see `subscription-concurrency.test.ts`.
 */
export async function cancelSubscription(rawInput: unknown): Promise<Subscription> {
  const input = parseOrThrow(cancelSchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const result = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const subscription = await subscriptionRepository.findCurrentForOrganizationLocked(input.organizationId, tx);
      if (!subscription || !subscription.providerSubscriptionId) {
        throw new SubscriptionChangeRejectedError("This organization has no active subscription to cancel.");
      }
      validateSubscriptionTransition(subscription.status, subscription.cancelAtPeriodEnd, input.atPeriodEnd ? "SCHEDULE_CANCELLATION" : "CANCEL_IMMEDIATELY");

      await stripeBillingProvider.cancelSubscription({ providerSubscriptionId: subscription.providerSubscriptionId, atPeriodEnd: input.atPeriodEnd });

      // Optimistic, LOCAL-ONLY flag update — never the authoritative
      // status transition (that arrives via `customer.subscription.
      // updated`/`.deleted`, see this file's own top comment).
      // `cancelAtPeriodEnd` is safe to set immediately: it mirrors
      // exactly what was just requested, not a guess about provider-
      // side outcome.
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
      return { row, subscriptionId: subscription.id };
    },
  );

  logger.info("Subscription cancellation requested.", {
    operation: "billing.subscription.cancel",
    organizationId: input.organizationId,
    subscriptionId: result.subscriptionId,
    atPeriodEnd: input.atPeriodEnd,
  });
  await events.emit("billing.subscription.cancel_requested", { organizationId: input.organizationId, subscriptionId: result.subscriptionId, atPeriodEnd: input.atPeriodEnd });
  return result.row;
}

/** Reverses a pending cancel-at-period-end (spec §28: "design for... resume"). Not valid once the subscription has actually reached CANCELED — Stripe itself rejects resuming a subscription that's already ended. Same locked-transaction discipline as `cancelSubscription()` above. */
export async function resumeSubscription(rawInput: unknown): Promise<Subscription> {
  const input = parseOrThrow(subscriptionActionSchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const result = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const subscription = await subscriptionRepository.findCurrentForOrganizationLocked(input.organizationId, tx);
      if (!subscription || !subscription.providerSubscriptionId) {
        throw new SubscriptionChangeRejectedError("This organization has no subscription to resume.");
      }
      validateSubscriptionTransition(subscription.status, subscription.cancelAtPeriodEnd, "UNDO_SCHEDULED_CANCELLATION");

      await stripeBillingProvider.resumeSubscription({ providerSubscriptionId: subscription.providerSubscriptionId });

      const row = await subscriptionRepository.setCancelAtPeriodEnd(subscription.id, false, tx);
      await audit.recordSuccess({
        action: "billing.subscription.resumed",
        organizationId: input.organizationId,
        resourceType: "subscription",
        resourceId: subscription.id,
        newState: { cancelAtPeriodEnd: false },
        tx,
      });
      return { row, subscriptionId: subscription.id };
    },
  );

  logger.info("Subscription resumed.", { operation: "billing.subscription.resume", organizationId: input.organizationId, subscriptionId: result.subscriptionId });
  await events.emit("billing.subscription.resumed", { organizationId: input.organizationId, subscriptionId: result.subscriptionId });
  return result.row;
}

const changePlanSchema = z.object({ organizationId: z.string().uuid(), planPriceId: z.string().uuid() });

/**
 * Resolves the caller's current subscription item + the target price,
 * shared by `previewPlanChange()` and `changeSubscriptionPlan()` so
 * both validate identically (spec §5's own UI contract: whatever the
 * preview showed must be exactly what applying the change does).
 */
async function resolvePlanChangeInputs(organizationId: string, planPriceId: string, tx: TransactionClient) {
  const subscription = await subscriptionRepository.findCurrentForOrganization(organizationId, tx);
  if (!subscription || !subscription.providerSubscriptionId) {
    throw new SubscriptionChangeRejectedError("This organization has no subscription to change.");
  }
  validateSubscriptionTransition(subscription.status, subscription.cancelAtPeriodEnd, "CHANGE_PLAN");

  const items = await subscriptionItemRepository.listForSubscription(subscription.id, tx);
  const currentItem = items[0];
  if (!currentItem || !currentItem.providerItemId) {
    throw new SubscriptionChangeRejectedError("This subscription has no item to change.");
  }

  const price = await planPriceRepository.findById(planPriceId);
  if (!price || !price.active) throw new PlanPriceNotFoundError();
  if (!price.providerPriceId) throw new SubscriptionChangeRejectedError("This plan price is not yet available for purchase.");
  if (price.id === currentItem.planPriceId) throw new SubscriptionChangeRejectedError("This organization is already on this plan price.");

  return { subscription, currentItem, price };
}

export interface PlanChangePreview {
  available: boolean;
  currency: string | null;
  immediateChangeAmount: number | null;
  totalAmount: number | null;
  effectiveAt: Date | null;
}

/** `billing.read` — a preview never mutates anything (spec §5). Read-only, so no row lock is needed; a concurrent change between preview and apply is still safe because `changeSubscriptionPlan()` re-validates and re-locks independently. */
export async function previewPlanChange(rawInput: unknown): Promise<PlanChangePreview> {
  const input = parseOrThrow(changePlanSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);

  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, async (tx) => {
    const { subscription, currentItem, price } = await resolvePlanChangeInputs(input.organizationId, input.planPriceId, tx);
    const preview = await stripeBillingProvider.previewSubscriptionChange({
      providerSubscriptionId: subscription.providerSubscriptionId!,
      providerItemId: currentItem.providerItemId!,
      providerPriceId: price.providerPriceId!,
      quantity: currentItem.quantity,
    });
    if (!preview.available) return { available: false, currency: null, immediateChangeAmount: null, totalAmount: null, effectiveAt: null };
    return {
      available: true,
      currency: preview.currency,
      immediateChangeAmount: preview.immediateChangeAmount,
      totalAmount: preview.totalAmount,
      effectiveAt: new Date(preview.effectiveAt * 1000),
    };
  });
}

/**
 * The REAL upgrade/downgrade (spec §5/§35) — updates the EXISTING
 * Stripe subscription item in place via `changeSubscription()`, never a
 * second Checkout Session (which would create a SECOND, competing
 * Stripe subscription for the same customer — see
 * `subscription-lifecycle.md` "The in-place change bug Module 13 left
 * behind"). Locked identically to `cancelSubscription()`/
 * `resumeSubscription()` — two concurrent plan-change requests
 * serialize on the same subscription row.
 */
export async function changeSubscriptionPlan(rawInput: unknown): Promise<Subscription> {
  const input = parseOrThrow(changePlanSchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const result = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      // Re-locked here (not just re-read) — `resolvePlanChangeInputs()`
      // itself only does a plain read; the lock is what actually
      // serializes a concurrent second plan-change attempt.
      const locked = await subscriptionRepository.findCurrentForOrganizationLocked(input.organizationId, tx);
      if (!locked) throw new SubscriptionChangeRejectedError("This organization has no subscription to change.");

      const { subscription, currentItem, price } = await resolvePlanChangeInputs(input.organizationId, input.planPriceId, tx);

      await stripeBillingProvider.changeSubscription({
        providerSubscriptionId: subscription.providerSubscriptionId!,
        providerItemId: currentItem.providerItemId!,
        providerPriceId: price.providerPriceId!,
        quantity: currentItem.quantity,
      });

      await audit.recordSuccess({
        action: "billing.plan.changed",
        organizationId: input.organizationId,
        resourceType: "subscription",
        resourceId: subscription.id,
        previousState: { planPriceId: currentItem.planPriceId },
        newState: { planPriceId: price.id },
        tx,
      });
      return { row: subscription, subscriptionId: subscription.id, fromPlanPriceId: currentItem.planPriceId, toPlanPriceId: price.id };
    },
  );

  logger.info("Subscription plan change requested.", {
    operation: "billing.subscription.change_plan",
    organizationId: input.organizationId,
    subscriptionId: result.subscriptionId,
    fromPlanPriceId: result.fromPlanPriceId,
    toPlanPriceId: result.toPlanPriceId,
  });
  // The actual new item/price only becomes visible locally once the
  // webhook reconciles it (this function's own top comment) — the
  // event emitted here signals "a change was requested," not "the
  // subscription now reflects it."
  await events.emit("billing.plan.change_requested", { organizationId: input.organizationId, subscriptionId: result.subscriptionId });
  return result.row;
}
